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
app.get('/', (req, res) => res.send('<h1>Horizon AI v8.0 - DEFINITIVO</h1><p>Status: Online</p>'));

// --- HELPER: CHAMADA DE IA ---
async function callAI(messages, isAuto = false) {
  // Se for automático, usamos um prompt de sistema extremamente agressivo e temperatura 0
  const systemPrompt = isAuto 
    ? "VOCÊ É UM MOTOR DE CORREÇÃO ORTOGRÁFICA RÍGIDO. Sua única função é corrigir o texto. NÃO DIGA 'Bom trabalho', NÃO DÊ EXPLICAÇÕES. Se houver erro, retorne APENAS o texto corrigido. Se NÃO houver erro, retorne APENAS o texto original. NUNCA responda com frases de cortesia."
    : "Você é um assistente útil. Responda sempre em Português (Brasil).";

  const payload = {
    model: "llama-3.3-70b-versatile",
    messages: [{ role: "system", content: systemPrompt }, ...messages],
    temperature: 0, // Zero para máxima precisão e zero criatividade
    max_tokens: 1000
  };

  try {
    const res = await axios.post('https://api.groq.com/openai/v1/chat/completions', payload, {
      headers: { 'Authorization': `Bearer ${GROQ_API_KEY}` },
      timeout: 10000
    });
    return res.data.choices[0].message.content;
  } catch (e) {
    console.error("Erro Groq:", e.message);
    // Fallback Pollinations
    try {
      const freeRes = await axios.post('https://text.pollinations.ai/', { 
        messages: [{ role: "system", content: systemPrompt }, ...messages] 
      }, { timeout: 10000 });
      return freeRes.data;
    } catch (err) {
      return "Erro de conexão.";
    }
  }
}

// --- ENDPOINT PRINCIPAL ---
app.post(['/api/completions/v1', '/api/chat/completions', '/api/completions'], async (req, res) => {
  const messages = req.body.messages || [];
  const bodyStr = JSON.stringify(req.body).toLowerCase();
  const lastMessage = messages.length > 0 ? messages[messages.length - 1].content : "";

  try {
    const isGrammarFull = bodyStr.includes('check the grammar') && bodyStr.includes('explanation');
    const isAutoGrammar = bodyStr.includes('just return the correct result');

    let finalPayload;

    if (isGrammarFull) {
      // Formato Objeto Completo
      const text = await callAI(messages, true);
      finalPayload = {
        original: lastMessage,
        improved: text.replace(/^"|"$/g, '').trim(),
        explanation: "Correção ortográfica e gramatical aplicada para melhorar a clareza."
      };
    } else if (isAutoGrammar) {
      // Formato de Autocorreção (O ponto principal)
      const text = await callAI(messages, true);
      const cleaned = text.replace(/^"|"$/g, '').trim();
      
      // Se a IA retornar algo como "Sua gramática está correta", nós forçamos o texto original
      if (cleaned.toLowerCase().includes("gramática") || cleaned.toLowerCase().includes("bom trabalho")) {
        finalPayload = { improved: lastMessage };
      } else {
        finalPayload = { improved: cleaned };
      }
    } else {
      // Chat normal
      const text = await callAI(messages, false);
      finalPayload = { content: text };
    }

    // CONFIGURAÇÃO SSE CRÍTICA PARA RETROFIT
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // O segredo para evitar o erro BEGIN_OBJECT:
    // O Retrofit espera que o "content" dentro do delta seja uma STRING que representa o JSON
    const sseResponse = {
      choices: [{
        delta: {
          content: JSON.stringify(finalPayload)
        }
      }]
    };

    res.write(`data: ${JSON.stringify(sseResponse)}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();

  } catch (error) {
    console.error("Erro Geral:", error.message);
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify({ improved: lastMessage }) } }] })}\n\n`);
    res.write('data: [DONE]\n\n');
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

app.listen(PORT, () => console.log(`Servidor v8.0 DEFINITIVO rodando na porta ${PORT}`));
