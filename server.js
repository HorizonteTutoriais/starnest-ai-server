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

// --- DASHBOARD ---
app.get('/', (req, res) => res.send('<h1>Horizon AI v19.0 - SOLUÇÃO CIRÚRGICA</h1><p>Status: Online</p>'));

// --- HELPER: CHAMADA DE IA ---
async function callAI(messages, systemPrompt, temperature = 0.7) {
  const payload = {
    model: "llama-3.3-70b-versatile",
    messages: [{ role: "system", content: systemPrompt }, ...messages],
    temperature: temperature,
    max_tokens: 1024
  };

  try {
    const response = await axios.post(GROQ_API_URL, payload, {
      headers: { 'Authorization': `Bearer ${GROQ_API_KEY}` },
      timeout: 15000
    });
    return response.data.choices[0].message.content;
  } catch (e) {
    console.error("Erro Groq:", e.message);
    return null;
  }
}

// --- LOGICA DE RESPOSTA ---
app.post('*', async (req, res) => {
  const messages = req.body.messages || [];
  const bodyStr = JSON.stringify(req.body).toLowerCase();
  const lastMessage = messages.length > 0 ? messages[messages.length - 1].content : "";

  // DETECÇÃO DE GRAMÁTICA (MUITO AGRESSIVA)
  const isGrammar = bodyStr.includes('grammar') || bodyStr.includes('check') || bodyStr.includes('correct') || bodyStr.includes('result');

  try {
    let contentToSend;

    if (isGrammar) {
      // PROMPT PARA GRAMÁTICA (JSON)
      const systemPrompt = `Você é um motor de correção gramatical. Analise o texto e retorne APENAS um objeto JSON válido com estas chaves: 
      "original": o texto enviado pelo usuário,
      "improved": o texto corrigido,
      "explanation": "Correção aplicada.",
      "isCorrect": false,
      "index": 0,
      "grammarExtensionType": "AUTO_CHECK",
      "rawOutput": "Correção aplicada."
      NÃO escreva nada fora do JSON.`;
      
      const aiResult = await callAI(messages, systemPrompt, 0);
      let finalJson;
      
      try {
        const jsonMatch = aiResult.match(/\{[\s\S]*\}/);
        finalJson = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
      } catch (e) { finalJson = null; }

      if (!finalJson) {
        finalJson = {
          original: lastMessage,
          improved: aiResult || lastMessage,
          explanation: "Correção aplicada.",
          isCorrect: false,
          index: 0,
          grammarExtensionType: "AUTO_CHECK",
          rawOutput: "Correção aplicada."
        };
      }
      contentToSend = JSON.stringify(finalJson);
    } else {
      // CHAT NORMAL
      const systemPrompt = "Você é um assistente de IA útil. Responda sempre em Português (Brasil).";
      const aiResult = await callAI(messages, systemPrompt, 0.7);
      contentToSend = aiResult || "Desculpe, não consegui processar sua mensagem.";
    }

    // PROTOCOLO SSE (STREAM) - USADO TANTO PARA CHAT QUANTO PARA GRAMÁTICA
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const chunk = {
      choices: [{
        delta: { content: contentToSend },
        index: 0,
        finish_reason: "stop"
      }]
    };

    res.write(`data: ${JSON.stringify(chunk)}\n\n`);
    res.write('data: [DONE]\n\n');
    return res.end();

  } catch (error) {
    console.error("Erro:", error.message);
    res.end();
  }
});

// --- IMAGENS ---
app.post('/api/image-generator', (req, res) => {
  const id = crypto.randomUUID();
  const prompt = req.body.prompt || "image";
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&nologo=true`;
  res.json({ data: { generationId: id, taskId: id, status: 'completed', percentage: '100', imageUrls: [{ url }] } });
});

app.listen(PORT, () => console.log(`Servidor v19.0 FINAL rodando na porta ${PORT}`));
