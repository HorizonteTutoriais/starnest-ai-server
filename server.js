const express = require('express');
const cors = require('cors');
const axios = require('axios');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Chaves de API
const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';

const imageTasks = new Map();

// --- PAINEL DE DIAGNÓSTICO (Abra no seu navegador) ---
app.get('/', async (req, res) => {
  let groqStatus = "Não configurado";
  let openaiStatus = "Não configurado";

  if (GROQ_API_KEY) {
    try {
      await axios.get('https://api.groq.com/openai/v1/models', { headers: { 'Authorization': `Bearer ${GROQ_API_KEY}` }, timeout: 5000 });
      groqStatus = "✅ Funcionando!";
    } catch (e) {
      groqStatus = `❌ Erro: ${e.response?.data?.error?.message || e.message}`;
    }
  }

  if (OPENAI_API_KEY) {
    try {
      await axios.get('https://api.openai.com/v1/models', { headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}` }, timeout: 5000 });
      openaiStatus = "✅ Funcionando!";
    } catch (e) {
      openaiStatus = `❌ Erro: ${e.response?.data?.error?.message || e.message}`;
    }
  }

  res.send(`
    <html>
      <head><title>Horizon AI Diagnostic</title></head>
      <body style="font-family: sans-serif; padding: 20px; line-height: 1.6;">
        <h1>Diagnóstico do Servidor Horizon</h1>
        <p>Este painel ajuda a identificar por que o teclado está dando erro.</p>
        <div style="background: #f4f4f4; padding: 15px; border-radius: 8px;">
          <h3>Status das APIs:</h3>
          <p><b>Groq:</b> ${groqStatus}</p>
          <p><b>OpenAI:</b> ${openaiStatus}</p>
        </div>
        <h3>Próximos Passos:</h3>
        <ul>
          <li>Se ambos estiverem com "❌ Erro", verifique as chaves no painel do Render.</li>
          <li>Se estiverem "Não configurado", você esqueceu de colocar as variáveis no Render.</li>
          <li>Se estiverem "✅", o problema pode ser no formato que o app envia.</li>
        </ul>
        <p><small>Versão do Servidor: 4.0 (Diagnóstica)</small></p>
      </body>
    </html>
  `);
});

// --- LOGICA DE IA COM FALLBACK PARA POLLINATIONS (GRÁTIS) ---
async function getAIResponse(payload) {
  // 1. Tentar Groq
  if (GROQ_API_KEY) {
    try {
      console.log("Tentando Groq...");
      const res = await axios.post('https://api.groq.com/openai/v1/chat/completions', payload, {
        headers: { 'Authorization': `Bearer ${GROQ_API_KEY}` }, timeout: 10000
      });
      return res.data.choices[0].message.content;
    } catch (e) { console.error("Falha no Groq"); }
  }

  // 2. Tentar OpenAI
  if (OPENAI_API_KEY) {
    try {
      console.log("Tentando OpenAI...");
      const res = await axios.post('https://api.openai.com/v1/chat/completions', payload, {
        headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}` }, timeout: 10000
      });
      return res.data.choices[0].message.content;
    } catch (e) { console.error("Falha na OpenAI"); }
  }

  // 3. Fallback Final (Pollinations AI - Grátis e sem chave)
  console.log("Usando Fallback Público...");
  const prompt = payload.messages[payload.messages.length - 1].content;
  const system = payload.messages[0].content;
  const res = await axios.post('https://text.pollinations.ai/', {
    messages: [{ role: "system", content: system }, { role: "user", content: prompt }]
  }, { timeout: 15000 });
  return res.data;
}

function sendSSE(res, content) {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  const sseData = { choices: [{ delta: { content: content } }] };
  res.write(`data: ${JSON.stringify(sseData)}\n\n`);
  res.write('data: [DONE]\n\n');
  res.end();
}

async function handleAIFunctions(req, res) {
  const bodyStr = JSON.stringify(req.body).toLowerCase();
  const messages = req.body.messages || [];
  
  try {
    const isGrammar = bodyStr.includes('check the grammar') || bodyStr.includes('confira a gramática');
    const isAuto = bodyStr.includes('just return the correct result');

    let system = "Você é um assistente útil em Português.";
    let forceJson = false;

    if (isGrammar && !isAuto) {
      system = `Você é um corretor gramatical. Retorne OBRIGATORIAMENTE um JSON: {"original": "...", "improved": "...", "explanation": "..."}`;
      forceJson = true;
    } else if (isAuto) {
      system = "Retorne APENAS o texto corrigido, sem explicações.";
    }

    const payload = {
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "system", content: system }, ...messages],
      temperature: 0.2,
      response_format: forceJson ? { type: "json_object" } : undefined
    };

    const content = await getAIResponse(payload);
    sendSSE(res, content);

  } catch (error) {
    console.error("Erro Final:", error.message);
    sendSSE(res, "Ocorreu um erro técnico persistente. Verifique o painel de diagnóstico do servidor.");
  }
}

app.post(['/api/completions/v1', '/api/chat/completions', '/api/completions'], handleAIFunctions);

// Imagens e Uploads
app.post('/api/image-generator', (req, res) => {
  const id = crypto.randomUUID();
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(req.body.prompt)}?width=1024&height=1024&seed=${Math.floor(Math.random()*1000)}`;
  imageTasks.set(id, { generationId: id, taskId: id, status: 'completed', percentage: '100', imageUrls: [{ url }] });
  res.json({ data: { generationId: id, taskId: id, status: 'completed' } });
});
app.get('/api/image-generator/:id', (req, res) => res.json({ data: imageTasks.get(req.params.id) || { status: 'failed' } }));
app.post('/api/upload', (req, res) => res.json({ status: "success", data: { url: "https://via.placeholder.com/150" } }));

app.listen(PORT, () => console.log(`Servidor de Diagnóstico rodando na porta ${PORT}`));
