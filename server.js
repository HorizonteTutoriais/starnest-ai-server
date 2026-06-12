const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' })); // Aumentado para suportar imagens/OCR

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_API_KEY = process.env.GROQ_API_KEY || '';

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'starnest-ai-server' });
});

async function handleCompletion(req, res) {
  try {
    // 1. Extração robusta de mensagens (Suporta Chat, OCR, PDF, Imagem)
    let messages = req.body.messages || [];
    let userMessage = req.body.message || req.body.prompt || req.body.text || req.body.content || '';
    
    if (!Array.isArray(messages) || messages.length === 0) {
      if (userMessage) {
        messages = [{ role: 'user', content: userMessage }];
      } else {
        messages = [{ role: 'user', content: 'Olá' }];
      }
    }

    // 2. Identificar se é Correção Gramatical (Grammar Check)
    // O app envia "Check grammar for this text..."
    const fullText = JSON.stringify(messages).toLowerCase();
    const isGrammarCheck = fullText.includes('check grammar') || fullText.includes('corrija');

    // 3. Preparar System Prompt
    const messagesWithSystem = [
      {
        role: 'system',
        content: 'Você é um assistente de IA útil. IMPORTANTE: Responda sempre em português (Brasil). Seja conciso.'
      },
      ...messages.map(m => ({
        role: m.role || 'user',
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
      }))
    ];

    // 4. Chamada para Groq (Corrigindo Erro 400 - Parâmetros simplificados)
    const groqPayload = {
      model: 'llama-3.3-70b-versatile',
      messages: messagesWithSystem,
      temperature: isGrammarCheck ? 0.2 : 0.7,
      max_tokens: 1024,
      top_p: 1,
      stream: false
    };

    const response = await axios.post(GROQ_API_URL, groqPayload, {
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    const aiResponse = response.data.choices[0]?.message?.content || '';

    // 5. RESPOSTA PARA O CORRETOR (JSON Estático)
    if (isGrammarCheck) {
      return res.json({
        choices: [{
          message: { content: aiResponse },
          finish_reason: "stop",
          index: 0
        }]
      });
    }

    // 6. RESPOSTA PARA CHAT/OCR/PDF (SSE Streaming)
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    
    // Dividir em chunks para simular digitação
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
    
    // Se falhar, tenta responder em formato que o app não trave
    if (!res.headersSent) {
      const errorMessage = "Desculpe, tive um problema técnico. Tente novamente.";
      if (JSON.stringify(req.body).includes('check grammar')) {
        res.json({ choices: [{ message: { content: errorMessage } }] });
      } else {
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: errorMessage } }] })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
      }
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
