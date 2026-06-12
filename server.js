const express = require('express');
const cors = require('cors');
const axios = require('axios');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

const GROQ_API_KEY = process.env.GROQ_API_KEY || '';

// --- DASHBOARD ---
app.get('/', (req, res) => res.send('<h1>Horizon AI v6.0</h1><p>Status: Online</p>'));

// --- HELPER: CHAMADA DE IA ---
async function callAI(messages, forceJson = false) {
  const payload = {
    model: "llama-3.3-70b-versatile",
    messages: messages,
    temperature: 0.2,
    response_format: forceJson ? { type: "json_object" } : undefined
  };

  try {
    const res = await axios.post('https://api.groq.com/openai/v1/chat/completions', payload, {
      headers: { 'Authorization': `Bearer ${GROQ_API_KEY}` }, timeout: 15000
    });
    return res.data.choices[0].message.content;
  } catch (e) {
    console.error("Erro Groq:", e.message);
    // Fallback Pollinations
    const freeRes = await axios.post('https://text.pollinations.ai/', { messages }, { timeout: 15000 });
    return freeRes.data;
  }
}

// --- ENDPOINT PRINCIPAL (CORRIGIDO PARA JSON OBJECT) ---
app.post(['/api/completions/v1', '/api/chat/completions', '/api/completions'], async (req, res) => {
  const bodyStr = JSON.stringify(req.body).toLowerCase();
  const messages = req.body.messages || [];

  try {
    const isGrammarFull = bodyStr.includes('check the grammar') && bodyStr.includes('explanation');
    const isAutoGrammar = bodyStr.includes('just return the correct result');

    let system = "Você é um assistente útil. Responda sempre em Português (Brasil).";
    let aiResponse;

    if (isGrammarFull) {
      system = `Você é um corretor gramatical rigoroso. Retorne EXATAMENTE este JSON:
      {"original": "...", "improved": "...", "explanation": "..."}`;
      const raw = await callAI([{ role: "system", content: system }, ...messages], true);
      aiResponse = JSON.parse(raw); // Converte string em objeto real
    } else if (isAutoGrammar) {
      system = "Retorne APENAS o texto corrigido, sem explicações.";
      const text = await callAI([{ role: "system", content: system }, ...messages]);
      aiResponse = { improved: text.replace(/"/g, '') }; // Encapsula em objeto
    } else {
      const text = await callAI([{ role: "system", content: system }, ...messages]);
      aiResponse = { content: text }; // Encapsula em objeto
    }

    // O segredo: O app espera um fluxo SSE, mas o conteúdo do fluxo DEVE ser o JSON da escolha
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    
    // Envolve a resposta no formato que o Retrofit espera dentro do delta
    const sseData = {
      choices: [{
        delta: {
          content: typeof aiResponse === 'string' ? aiResponse : JSON.stringify(aiResponse)
        }
      }]
    };
    
    res.write(`data: ${JSON.stringify(sseData)}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();

  } catch (error) {
    console.error("Erro 400 fix:", error.message);
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "Erro ao processar IA" } }] })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  }
});

// --- IMAGENS ---
app.post('/api/image-generator', (req, res) => {
  const id = crypto.randomUUID();
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(req.body.prompt)}?width=1024&height=1024&nologo=true`;
  const task = { generationId: id, taskId: id, status: 'completed', percentage: '100', imageUrls: [{ url }] };
  imageTasks.set(id, task);
  res.json({ data: task });
});

app.get('/api/image-generator/:id', (req, res) => res.json({ data: imageTasks.get(req.params.id) || { status: 'failed' } }));

app.post('/api/upload', (req, res) => res.json({ status: "success", data: { url: "https://via.placeholder.com/150" } }));

app.listen(PORT, () => console.log(`Servidor v6.0 rodando na porta ${PORT}`));
