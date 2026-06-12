const express = require('express');
const cors = require('cors');
const axios = require('axios');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Configurações de API
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_API_KEY = process.env.GROQ_API_KEY || '';

const imageTasks = new Map();

// Middleware de Log para depuração no Render
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  if (req.body && Object.keys(req.body).length > 0) {
    console.log('Body:', JSON.stringify(req.body).substring(0, 500));
  }
  next();
});

function sendSSE(res, content) {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  
  const sseData = {
    choices: [{ delta: { content: content } }]
  };
  res.write(`data: ${JSON.stringify(sseData)}\n\n`);
  res.write('data: [DONE]\n\n');
  res.end();
}

async function handleAIFunctions(req, res) {
  try {
    const messages = req.body.messages || [];
    const fullBody = JSON.stringify(req.body).toLowerCase();
    
    // Identificação agressiva da função baseada nos prompts do APK
    const isGrammarCheck = fullBody.includes('check the grammar') || fullBody.includes('confira a gramática') || fullBody.includes('explanation');
    const isAutoGrammar = fullBody.includes('just return the correct result') || fullBody.includes('no explanation needed');
    const isImageVision = messages.some(m => Array.isArray(m.content) && m.content.some(c => c.type === 'image_url'));

    let systemPrompt = "Você é um assistente de IA útil. Responda sempre em Português (Brasil).";
    let forceJson = false;

    if (isGrammarCheck && !isAutoGrammar) {
      systemPrompt = `Você é um corretor gramatical. Analise o texto enviado pelo usuário. 
      Você DEVE retornar OBRIGATORIAMENTE um objeto JSON com esta estrutura exata:
      {
        "original": "o texto original do usuário",
        "improved": "o texto corrigido",
        "explanation": "uma breve explicação em português do que foi corrigido"
      }
      Se não houver erros, "improved" deve ser igual ao "original" e "explanation" deve ser "A frase está gramaticalmente correta".`;
      forceJson = true;
    } else if (isAutoGrammar) {
      systemPrompt = "Você é um corretor gramatical. Retorne APENAS o texto corrigido, sem explicações, sem aspas e sem saudações.";
    }

    const payload = {
      model: isImageVision ? "llama-3.2-11b-vision-preview" : "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: systemPrompt },
        ...messages.map(m => ({
          role: m.role,
          content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
        }))
      ],
      temperature: 0.2
    };

    if (forceJson) {
      payload.response_format = { type: "json_object" };
    }

    const response = await axios.post(GROQ_API_URL, payload, {
      headers: { 'Authorization': `Bearer ${GROQ_API_KEY}` }
    });

    let aiContent = response.data.choices[0].message.content;
    
    // O app espera stream (SSE) para todos os completions
    sendSSE(res, aiContent);

  } catch (error) {
    console.error("Erro na IA:", error.response?.data || error.message);
    sendSSE(res, "Desculpe, tive um problema técnico. Tente novamente.");
  }
}

app.post(['/api/completions/v1', '/api/chat/completions', '/api/completions'], handleAIFunctions);

app.post('/api/image-generator', async (req, res) => {
  try {
    const { prompt, style } = req.body;
    const generationId = crypto.randomUUID();
    const taskId = crypto.randomUUID();

    const seed = Math.floor(Math.random() * 1000000);
    const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt + ", " + (style || "")) }?seed=${seed}&width=1024&height=1024&nologo=true`;

    imageTasks.set(generationId, {
      generationId,
      taskId,
      status: 'completed',
      percentage: '100',
      imageUrls: [{ url: imageUrl }]
    });

    res.json({
      data: {
        generationId,
        taskId,
        status: 'completed',
        percentage: '100',
        imageUrls: [{ url: imageUrl }]
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/image-generator/:id', (req, res) => {
  const task = imageTasks.get(req.params.id);
  if (!task) return res.status(404).json({ error: "Task not found" });
  res.json({ data: task });
});

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

app.listen(PORT, () => console.log(`Servidor Horizon rodando na porta ${PORT}`));
