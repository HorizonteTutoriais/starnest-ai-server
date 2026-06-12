const express = require('express');
const cors = require('cors');
const axios = require('axios');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Configurações de API - O usuário pode preencher uma ou ambas no Render
const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';

const imageTasks = new Map();

// Middleware de Log Aprimorado
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${req.method} ${req.url}`);
  next();
});

// Função para enviar resposta SSE com segurança
function sendSSE(res, content) {
  if (res.writableEnded) return;
  
  try {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    
    const sseData = {
      choices: [{ delta: { content: content } }]
    };
    res.write(`data: ${JSON.stringify(sseData)}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (e) {
    console.error("Erro ao enviar SSE:", e.message);
  }
}

// Função de Chat com Fallback
async function callAI(payload, useOpenAI = false) {
  if (useOpenAI && OPENAI_API_KEY) {
    console.log("Tentando via OpenAI...");
    return await axios.post('https://api.openai.com/v1/chat/completions', {
      ...payload,
      model: payload.model.includes('vision') ? "gpt-4o-mini" : "gpt-4o-mini"
    }, {
      headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}` },
      timeout: 15000
    });
  } else if (GROQ_API_KEY) {
    console.log("Tentando via Groq...");
    return await axios.post('https://api.groq.com/openai/v1/chat/completions', payload, {
      headers: { 'Authorization': `Bearer ${GROQ_API_KEY}` },
      timeout: 10000
    });
  }
  throw new Error("Nenhuma chave de API configurada (GROQ_API_KEY ou OPENAI_API_KEY)");
}

async function handleAIFunctions(req, res) {
  const bodyStr = JSON.stringify(req.body).toLowerCase();
  const messages = req.body.messages || [];
  
  try {
    const isGrammarCheck = bodyStr.includes('check the grammar') || bodyStr.includes('confira a gramática') || bodyStr.includes('explanation');
    const isAutoGrammar = bodyStr.includes('just return the correct result') || bodyStr.includes('no explanation needed');
    const isVision = messages.some(m => Array.isArray(m.content) && m.content.some(c => c.type === 'image_url'));

    let systemPrompt = "Você é um assistente de IA útil. Responda sempre em Português (Brasil).";
    let forceJson = false;

    if (isGrammarCheck && !isAutoGrammar) {
      systemPrompt = `Você é um corretor gramatical. Retorne OBRIGATORIAMENTE um JSON: {"original": "...", "improved": "...", "explanation": "..."}`;
      forceJson = true;
    } else if (isAutoGrammar) {
      systemPrompt = "Retorne APENAS o texto corrigido, sem explicações.";
    }

    const payload = {
      model: isVision ? "llama-3.2-11b-vision-preview" : "llama-3.3-70b-versatile",
      messages: [{ role: "system", content: systemPrompt }, ...messages],
      temperature: 0.2,
      response_format: forceJson ? { type: "json_object" } : undefined
    };

    let response;
    try {
      response = await callAI(payload);
    } catch (err) {
      console.warn("Primeira tentativa falhou, tentando fallback...");
      // Se falhou no Groq e temos OpenAI, tenta OpenAI. Ou vice-versa.
      response = await callAI(payload, !GROQ_API_KEY);
    }

    sendSSE(res, response.data.choices[0].message.content);

  } catch (error) {
    console.error("ERRO CRÍTICO:", error.message);
    // Se tudo falhar, envia uma resposta amigável no formato que o app não quebra
    const fallbackMsg = bodyStr.includes('explanation') 
      ? JSON.stringify({ original: "Erro", improved: "Erro de conexão", explanation: "O servidor de IA demorou muito a responder. Tente novamente em instantes." })
      : "Desculpe, o serviço de IA está instável no momento. Por favor, tente novamente.";
    sendSSE(res, fallbackMsg);
  }
}

app.post(['/api/completions/v1', '/api/chat/completions', '/api/completions'], handleAIFunctions);

// Geração de Imagem com tratamento de erro
app.post('/api/image-generator', async (req, res) => {
  try {
    const { prompt } = req.body;
    const id = crypto.randomUUID();
    const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&nologo=true&seed=${Math.floor(Math.random()*1000)}`;
    
    imageTasks.set(id, { generationId: id, taskId: id, status: 'completed', percentage: '100', imageUrls: [{ url }] });
    res.json({ data: { generationId: id, taskId: id, status: 'completed' } });
  } catch (e) {
    res.status(500).json({ error: "Erro ao gerar imagem" });
  }
});

app.get('/api/image-generator/:id', (req, res) => {
  const task = imageTasks.get(req.params.id);
  res.json({ data: task || { status: 'failed' } });
});

app.post('/api/upload', (req, res) => res.json({ status: "success", data: { url: "https://via.placeholder.com/150" } }));
app.get('/health', (req, res) => res.json({ status: "ok" }));

app.listen(PORT, () => console.log(`Servidor Ativo na porta ${PORT}`));
