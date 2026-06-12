const express = require('express');
const cors = require('cors');
const axios = require('axios');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';

const imageTasks = new Map();

// --- DASHBOARD DE STATUS ---
app.get('/', (req, res) => {
  res.send(`<h1>Horizon AI v5.0</h1><p>Status: Online</p><p>Groq: ${GROQ_API_KEY ? "Configurada" : "Ausente"}</p>`);
});

// --- HELPER: CHAMADA DE IA ---
async function callAI(messages, forceJson = false) {
  const payload = {
    model: "llama-3.3-70b-versatile",
    messages: messages,
    temperature: 0.2,
    response_format: forceJson ? { type: "json_object" } : undefined
  };

  try {
    if (GROQ_API_KEY) {
      const res = await axios.post('https://api.groq.com/openai/v1/chat/completions', payload, {
        headers: { 'Authorization': `Bearer ${GROQ_API_KEY}` }, timeout: 15000
      });
      return res.data.choices[0].message.content;
    }
    // Fallback Grátis
    const freeRes = await axios.post('https://text.pollinations.ai/', {
      messages: messages
    }, { timeout: 15000 });
    return freeRes.data;
  } catch (e) {
    console.error("Erro na chamada de IA:", e.message);
    throw e;
  }
}

// --- ENDPOINTS DE TEXTO E BUBBLE AI ---
app.post(['/api/completions/v1', '/api/chat/completions', '/api/completions'], async (req, res) => {
  const body = req.body;
  const bodyStr = JSON.stringify(body).toLowerCase();
  const messages = body.messages || [];

  try {
    // 1. Identificar se é Gramática que espera JSON
    const isGrammarFull = bodyStr.includes('check the grammar') && bodyStr.includes('explanation');
    
    if (isGrammarFull) {
      const system = `Você é um corretor gramatical rigoroso. Analise o texto e retorne EXATAMENTE este JSON:
      {"original": "texto do usuário", "improved": "texto corrigido", "explanation": "explicação curta em português"}`;
      
      const aiContent = await callAI([{ role: "system", content: system }, ...messages], true);
      
      // O app espera o JSON dentro de um fluxo SSE
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: aiContent } }] })}\n\n`);
      res.write('data: [DONE]\n\n');
      return res.end();
    }

    // 2. Outras funções (Traduzir, Tom, Responder) - Resposta de texto direto via SSE
    const system = "Você é um assistente útil. Responda sempre em Português (Brasil). Retorne APENAS o resultado solicitado, sem conversas.";
    const aiContent = await callAI([{ role: "system", content: system }, ...messages]);
    
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: aiContent } }] })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();

  } catch (error) {
    console.error("Erro no Completion:", error.message);
    res.status(500).send("Erro interno");
  }
});

// --- ENDPOINTS DE IMAGEM ---
app.post('/api/image-generator', (req, res) => {
  const id = crypto.randomUUID();
  const prompt = req.body.prompt || "cool image";
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&nologo=true&seed=${Math.floor(Math.random()*1000)}`;
  
  imageTasks.set(id, { 
    generationId: id, 
    taskId: id, 
    status: 'completed', 
    percentage: '100', 
    imageUrls: [{ url: url }] 
  });
  
  // O app espera este formato exato para não dar erro
  res.json({
    data: {
      generationId: id,
      taskId: id,
      status: 'completed',
      percentage: '100',
      imageUrls: [{ url: url }]
    }
  });
});

app.get('/api/image-generator/:id', (req, res) => {
  const task = imageTasks.get(req.params.id);
  res.json({ data: task || { status: 'failed' } });
});

// --- ENDPOINT DE UPLOAD (VISÃO) ---
app.post('/api/upload', (req, res) => {
  res.json({
    status: "success",
    data: {
      url: "https://via.placeholder.com/150",
      message: "Upload successful"
    }
  });
});

app.get('/health', (req, res) => res.json({ status: "ok" }));

app.listen(PORT, () => console.log(`Servidor v5.0 Ativo na porta ${PORT}`));
