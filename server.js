const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_API_KEY = process.env.GROQ_API_KEY || '';

app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    service: 'starnest-ai-server'
  });
});

async function handleCompletion(req, res) {
  try {
    let messages = req.body.messages || [];
    let userMessage = req.body.message || req.body.prompt || req.body.text || '';
    
    if (!Array.isArray(messages) || messages.length === 0) {
      if (userMessage) {
        messages = [{ role: 'user', content: userMessage }];
      } else {
        userMessage = 'Olá';
        messages = [{ role: 'user', content: userMessage }];
      }
    }

    // Identificar se é um pedido de correção ortográfica (Grammar Check)
    const isGrammarCheck = messages.some(m => 
      m.content && (m.content.toLowerCase().includes('check grammar') || m.content.toLowerCase().includes('corrija'))
    );

    const messagesWithSystem = [
      {
        role: 'system',
        content: 'Você é um assistente de IA útil. IMPORTANTE: Sempre responda em português (Brasil). Seja conciso.'
      },
      ...messages
    ];

    const response = await axios.post(GROQ_API_URL, {
      model: 'llama-3.3-70b-versatile',
      messages: messagesWithSystem,
      stream: false, // Mantemos false para processar a resposta antes de enviar
      temperature: 0.3,
      max_tokens: 1024
    }, {
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    const text = response.data.choices[0]?.message?.content || '';

    // SE FOR CORREÇÃO ORTOGRÁFICA: Enviar JSON Simples (O que o corretor espera)
    if (isGrammarCheck) {
      return res.json({
        choices: [
          {
            message: {
              content: text
            }
          }
        ]
      });
    }

    // SE FOR CHAT: Enviar Formato SSE (O que o chat espera)
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    
    const chunks = text.match(/[\s\S]{1,30}/g) || [text];
    for (const chunk of chunks) {
      const sseData = {
        choices: [{ delta: { content: chunk } }]
      };
      res.write(`data: ${JSON.stringify(sseData)}\n\n`);
    }
    res.write('data: [DONE]\n\n');
    res.end();
    
  } catch (error) {
    console.error('Erro:', error.message);
    if (!res.headersSent) {
      res.status(500).json({ error: error.message });
    }
  }
}

app.post('/api/completions/v1', handleCompletion);
app.post('/api/completions/stream', handleCompletion);
app.post('/api/chat/completions', handleCompletion);
app.post('/api/completions', handleCompletion);

app.options('*', cors());

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
    
