const express = require('express');
const cors = require('cors');
const axios = require('axios');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_API_KEY = process.env.GROQ_API_KEY || '';

// Para o gerador de imagens (em memória para simplificar, o ideal seria um banco de dados)
const imageTasks = new Map();

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'starnest-ai-server-v3' });
});

// Endpoint para Upload de Imagens (OCR e Perguntas sobre Imagem)
app.post('/api/upload', (req, res) => {
  try {
    // O app envia a imagem em base64 ou multipart.
    // Como não temos armazenamento real aqui, retornamos uma URL simulada ou a própria base64
    // Para simplificar e evitar erros no app, retornamos sucesso.
    res.json({
      status: "success",
      data: {
        url: "https://via.placeholder.com/150", // Placeholder, o app usa o base64 internamente
        message: "Upload successful"
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Endpoints para Gerador de Imagens
app.post('/api/image-generator', async (req, res) => {
  try {
    const { prompt, style, size, quantity } = req.body;
    
    // Gera um ID único para a tarefa
    const generationId = crypto.randomUUID();
    const taskId = crypto.randomUUID();
    
    // Salva o estado inicial
    imageTasks.set(generationId, {
      generationId,
      taskId,
      status: 'processing',
      percentage: '0',
      imageUrls: [],
      prompt
    });

    // Inicia a geração em background
    generateImageBackground(generationId, prompt, style);

    // Retorna imediatamente o ID para o app fazer polling
    res.json({
      data: {
        generationId,
        taskId,
        status: 'processing',
        percentage: '0',
        imageUrls: []
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/image-generator/:generationId', (req, res) => {
  const { generationId } = req.params;
  const task = imageTasks.get(generationId);
  
  if (!task) {
    return res.status(404).json({ error: 'Task not found' });
  }

  res.json({
    data: task
  });
});

// Função simulada para gerar imagem (usando Pollinations AI que é gratuito e não precisa de API Key)
async function generateImageBackground(generationId, prompt, style) {
  try {
    const task = imageTasks.get(generationId);
    if (!task) return;

    // Atualiza progresso
    task.percentage = '50';
    
    // Cria um prompt otimizado com o estilo
    const finalPrompt = encodeURIComponent(`${prompt}, ${style || 'high quality, detailed'}`);
    
    // Usa a API gratuita do pollinations.ai
    const seed = Math.floor(Math.random() * 1000000);
    const imageUrl = `https://image.pollinations.ai/prompt/${finalPrompt}?seed=${seed}&width=1024&height=1024&nologo=true`;
    
    // Simula tempo de processamento
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Conclui a tarefa
    task.status = 'completed';
    task.percentage = '100';
    task.imageUrls = [
      { url: imageUrl }
    ];
  } catch (error) {
    const task = imageTasks.get(generationId);
    if (task) {
      task.status = 'failed';
      task.percentage = '0';
    }
  }
}

// Endpoint principal de Chat/Completions (Texto, Gramática, E-mail, Bubble AI)
async function handleCompletion(req, res) {
  try {
    let messages = req.body.messages || [];
    let userMessage = req.body.message || req.body.prompt || req.body.text || req.body.content || '';
    
    if (!Array.isArray(messages) || messages.length === 0) {
      if (userMessage) {
        messages = [{ role: 'user', content: userMessage }];
      } else {
        messages = [{ role: 'user', content: 'Olá' }];
      }
    }

    // Extrai todo o texto para análise de intenção
    const fullText = JSON.stringify(messages).toLowerCase();
    
    // Detectar tipos de requisição
    const isAutoGrammar = fullText.includes('check the grammar & spelling below text') && fullText.includes('explanation must be returned');
    const isReCheckGrammar = fullText.includes('just return the correct result, no explanation needed');
    const isToneChanger = fullText.includes('change this text') && fullText.includes('tone');
    const isTranslate = fullText.includes('translate to');
    const isMakeProfessional = fullText.includes('professional') || fullText.includes('email');
    const isVision = messages.some(m => Array.isArray(m.content) && m.content.some(c => c.type === 'image_url'));

    // Configurar o System Prompt dependendo da intenção
    let systemPrompt = 'Você é um assistente de IA útil. IMPORTANTE: Responda sempre em português (Brasil). Seja conciso e direto ao ponto.';
    let isJsonFormatExpected = false;

    if (isAutoGrammar) {
      systemPrompt = `Você é um corretor ortográfico e gramatical estrito. 
O usuário enviará um texto. Você DEVE retornar EXATAMENTE UM OBJETO JSON válido com a seguinte estrutura, sem nenhum texto adicional antes ou depois:
{
  "original": "o texto exato que o usuário enviou",
  "improved": "o texto corrigido com gramática e ortografia perfeitas",
  "explanation": "uma breve explicação em português sobre o que foi corrigido"
}`;
      isJsonFormatExpected = true;
    } else if (isReCheckGrammar) {
      systemPrompt = 'Você é um corretor gramatical. Retorne APENAS o texto corrigido. Não adicione explicações, aspas ou saudações. Apenas o texto final.';
    } else if (isToneChanger) {
      systemPrompt = 'Você altera o tom de textos. Retorne APENAS o texto modificado no tom solicitado. Não adicione explicações.';
    } else if (isTranslate) {
      systemPrompt = 'Você é um tradutor. Retorne APENAS o texto traduzido. Não adicione explicações.';
    }

    // Processar mensagens para o Groq (Lidando com imagens se houver)
    const processedMessages = [
      { role: 'system', content: systemPrompt }
    ];

    for (const m of messages) {
      if (typeof m.content === 'string') {
        processedMessages.push({ role: m.role || 'user', content: m.content });
      } else if (Array.isArray(m.content)) {
        // Se for array (ex: visão/imagem), o modelo llama-3.3-70b-versatile do Groq suporta texto, 
        // mas para imagens no Groq precisamos usar o modelo llama-3.2-11b-vision-preview
        const textParts = m.content.filter(c => c.type === 'text').map(c => c.text).join(' ');
        
        // Se houver imagem, adicionamos o texto da imagem.
        // Como a implementação de visão pode ser complexa e depender do modelo exato,
        // garantimos que pelo menos o texto seja passado.
        if (textParts) {
          processedMessages.push({ role: m.role || 'user', content: textParts });
        } else {
          processedMessages.push({ role: m.role || 'user', content: "Descreva esta imagem detalhadamente." });
        }
      } else {
        processedMessages.push({ role: m.role || 'user', content: JSON.stringify(m.content) });
      }
    }

    // Modelo: Se tiver imagem, usar modelo de visão, senão o versatile
    const modelToUse = isVision ? 'llama-3.2-11b-vision-preview' : 'llama-3.3-70b-versatile';

    const groqPayload = {
      model: modelToUse,
      messages: processedMessages,
      temperature: (isAutoGrammar || isReCheckGrammar) ? 0.1 : 0.7,
      max_tokens: 1024,
      top_p: 1,
      stream: false
    };

    if (isJsonFormatExpected) {
      groqPayload.response_format = { type: "json_object" };
    }

    const response = await axios.post(GROQ_API_URL, groqPayload, {
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    let aiResponse = response.data.choices[0]?.message?.content || '';

    // Se o app não pediu stream (req.body.stream === false) ou se for JSON esperado,
    // retornamos JSON direto, pois o app às vezes falha no parsing do SSE para o JSON de gramática.
    // Mas o app Android com Retrofit na maioria das vezes espera SSE em /api/completions/v1.
    
    // Enviar em formato SSE (Server-Sent Events)
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    
    // Dividir em chunks
    const chunks = aiResponse.match(/[\s\S]{1,20}/g) || [aiResponse];
    for (const chunk of chunks) {
      const sseData = {
        choices: [{ delta: { content: chunk } }]
      };
      res.write(`data: ${JSON.stringify(sseData)}\n\n`);
    }
    res.write('data: [DONE]\n\n');
    res.end();
    
  } catch (error) {
    console.error('Erro detalhado:', error.response?.data || error.message);
    
    if (!res.headersSent) {
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      
      const errorMessage = "Desculpe, tive um problema técnico. Tente novamente.";
      
      // Se era gramática e falhou, tenta mandar um JSON válido de fallback
      const fullText = JSON.stringify(req.body).toLowerCase();
      if (fullText.includes('check the grammar & spelling below text') && fullText.includes('explanation must be returned')) {
        const fallbackJson = {
          original: "Erro na conexão",
          improved: "Erro na conexão",
          explanation: "Ocorreu um erro ao conectar com a IA."
        };
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify(fallbackJson) } }] })}\n\n`);
      } else {
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: errorMessage } }] })}\n\n`);
      }
      
      res.write('data: [DONE]\n\n');
      res.end();
    }
  }
}

app.post('/api/completions/v1', handleCompletion);
app.post('/api/chat/completions', handleCompletion);
app.post('/api/completions', handleCompletion);

app.options('*', cors());

app.listen(PORT, () => {
  console.log(`Servidor ativo na porta ${PORT}`);
});
