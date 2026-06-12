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
app.get('/', (req, res) => res.send('<h1>Horizon AI v11.0 - DEFINITIVO</h1><p>Status: Online</p>'));

// --- HELPER: CHAMADA DE IA ---
async function callAI(messages, systemPrompt, temperature = 0.7) {
  const payload = {
    model: "llama-3.3-70b-versatile",
    messages: [{ role: "system", content: systemPrompt }, ...messages],
    temperature: temperature,
    max_tokens: 1024
  };

  try {
    const res = await axios.post(GROQ_API_URL, payload, {
      headers: { 'Authorization': `Bearer ${GROQ_API_KEY}` },
      timeout: 10000
    });
    return res.data.choices[0].message.content;
  } catch (e) {
    console.error("Erro Groq:", e.message);
    return null;
  }
}

// --- ENDPOINT PRINCIPAL ---
app.post(['/api/completions/v1', '/api/chat/completions', '/api/completions'], async (req, res) => {
  const messages = req.body.messages || [];
  const bodyStr = JSON.stringify(req.body).toLowerCase();
  const lastMessage = messages.length > 0 ? messages[messages.length - 1].content : "";

  try {
    // 1. Identificar a função solicitada pelo APK
    const isGrammarFull = bodyStr.includes('check the grammar') && bodyStr.includes('explanation');
    const isAutoGrammar = bodyStr.includes('just return the correct result');

    if (isGrammarFull || isAutoGrammar) {
      // PROMPT PARA GRAMÁTICA (JSON)
      const systemPrompt = `Você é um motor de correção gramatical. Analise o texto e retorne APENAS um objeto JSON válido com estas chaves: 
      "original": o texto enviado pelo usuário,
      "improved": o texto corrigido (se não houver erro, repita o original),
      "explanation": uma explicação curta em português do que foi corrigido (se não houver erro, deixe vazio),
      "isCorrect": um booleano (true se o texto original já estava correto, false se houve correção).
      NÃO escreva nada fora do JSON.`;
      
      const aiResult = await callAI(messages, systemPrompt, 0);
      let finalJson;
      
      try {
        const jsonMatch = aiResult.match(/\{[\s\S]*\}/);
        finalJson = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
      } catch (e) {
        finalJson = null;
      }

      if (!finalJson) {
        finalJson = {
          original: lastMessage,
          improved: aiResult || lastMessage,
          explanation: "Correção aplicada.",
          isCorrect: false
        };
      }

      // IMPORTANTE: Para Gramática, o APK NÃO usa SSE, ele espera um JSON direto!
      // Mas como o endpoint é o mesmo, vamos enviar o JSON direto sem o formato de stream choices/delta
      return res.json(finalJson);
    } 
    
    // 2. CHAT NORMAL (SSE)
    // Se não for gramática, usamos o formato SSE que fez o chat funcionar
    const systemPrompt = "Você é um assistente de IA útil. Responda sempre em Português (Brasil).";
    const aiResult = await callAI(messages, systemPrompt, 0.7);
    const contentToSend = aiResult || "Desculpe, não consegui processar sua mensagem.";

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const sseData = {
      choices: [{
        delta: {
          content: contentToSend
        }
      }]
    };

    res.write(`data: ${JSON.stringify(sseData)}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();

  } catch (error) {
    console.error("Erro Geral:", error.message);
    res.status(500).json({ error: "Erro interno" });
  }
});

// --- IMAGENS ---
app.post('/api/image-generator', (req, res) => {
  const id = crypto.randomUUID();
  const prompt = req.body.prompt || "image";
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&nologo=true`;
  res.json({ data: { generationId: id, taskId: id, status: 'completed', percentage: '100', imageUrls: [{ url }] } });
});

app.listen(PORT, () => console.log(`Servidor v11.0 DEFINITIVO rodando na porta ${PORT}`));
