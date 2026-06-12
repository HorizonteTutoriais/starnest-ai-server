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
app.get('/', (req, res) => res.send('<h1>Horizon AI v7.0 - Final</h1><p>Status: Online e Cirúrgico</p>'));

// --- HELPER: CHAMADA DE IA ---
async function callAI(messages, forceJson = false) {
  const payload = {
    model: "llama-3.3-70b-versatile",
    messages: messages,
    temperature: 0.1, // Temperatura baixa para maior precisão na correção
    response_format: forceJson ? { type: "json_object" } : undefined
  };

  try {
    const res = await axios.post('https://api.groq.com/openai/v1/chat/completions', payload, {
      headers: { 'Authorization': `Bearer ${GROQ_API_KEY}` }, 
      timeout: 15000
    });
    return res.data.choices[0].message.content;
  } catch (e) {
    console.error("Erro Groq:", e.message);
    // Fallback Pollinations se Groq falhar
    try {
      const freeRes = await axios.post('https://text.pollinations.ai/', { messages }, { timeout: 15000 });
      return freeRes.data;
    } catch (err) {
      return "Erro na conexão com a IA.";
    }
  }
}

// --- ENDPOINT PRINCIPAL ---
app.post(['/api/completions/v1', '/api/chat/completions', '/api/completions'], async (req, res) => {
  const body = req.body;
  const messages = body.messages || [];
  const lastMessage = messages.length > 0 ? messages[messages.length - 1].content : "";
  const bodyStr = JSON.stringify(body).toLowerCase();

  try {
    // Identifica se é Verificação Gramatical Completa (com explicação)
    const isGrammarFull = bodyStr.includes('check the grammar') && bodyStr.includes('explanation');
    // Identifica se é Ortografia Automática (gatilho principal que estava falhando)
    const isAutoGrammar = bodyStr.includes('just return the correct result');

    let aiResponse;

    if (isGrammarFull) {
      const system = `Você é um corretor gramatical. Responda APENAS em JSON: {"original": "texto original", "improved": "texto corrigido", "explanation": "explicação curta em português"}`;
      const raw = await callAI([{ role: "system", content: system }, ...messages], true);
      try {
        aiResponse = JSON.parse(raw);
      } catch (e) {
        aiResponse = { original: lastMessage, improved: raw, explanation: "Correção aplicada." };
      }
    } else if (isAutoGrammar) {
      // Lógica cirúrgica para Ortografia Automática
      const system = "Você é um motor de autocorreção. Retorne APENAS o texto corrigido. Sem aspas, sem explicações, sem introduções. Se o texto estiver correto, retorne o texto original.";
      const text = await callAI([{ role: "system", content: system }, ...messages]);
      // Limpa a resposta de possíveis aspas ou lixo da IA
      const cleanedText = text.replace(/^"|"$/g, '').trim();
      aiResponse = { improved: cleanedText };
    } else {
      // Chat normal ou outras funções
      const system = "Você é um assistente útil. Responda sempre em Português (Brasil).";
      const text = await callAI([{ role: "system", content: system }, ...messages]);
      aiResponse = { content: text };
    }

    // O App Android (Retrofit) espera um stream SSE com um JSON específico dentro do delta.content
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

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
    console.error("Erro Processamento:", error.message);
    const errorData = { choices: [{ delta: { content: JSON.stringify({ error: "Erro ao processar" }) } }] };
    res.write(`data: ${JSON.stringify(errorData)}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  }
});

// --- IMAGENS (Pollinations) ---
app.post('/api/image-generator', (req, res) => {
  const id = crypto.randomUUID();
  const prompt = req.body.prompt || "image";
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&nologo=true`;
  res.json({ data: { generationId: id, taskId: id, status: 'completed', percentage: '100', imageUrls: [{ url }] } });
});

app.listen(PORT, () => console.log(`Servidor Horizon AI v7.0 rodando na porta ${PORT}`));
