const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Usar API Groq (grátis)
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_API_KEY = process.env.GROQ_API_KEY || '';

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Endpoint principal para completions
app.post('/api/completions/v1', async (req, res) => {
  try {
    // Extrair mensagem
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

    // Adicionar system prompt
    const messagesWithSystem = [
      {
        role: 'system',
        content: 'Você é um assistente de IA útil. IMPORTANTE: Sempre responda em português (Brasil). Todas as suas respostas devem ser em português.'
      },
      ...messages.map((m) => ({
        role: m.role || 'user',
        content: m.content || ''
      }))
    ];

    // Chamar API Groq (grátis)
    const response = await axios.post(GROQ_API_URL, {
      model: 'llama-3.3-70b-versatile',
      messages: messagesWithSystem,
      stream: false,
      temperature: 0.7,
      max_tokens: 1024
    }, {
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    // Extrair texto
    const textContent = response.data.choices[0]?.message?.content;
    let text = 'Desculpe, não consegui gerar uma resposta.';
    if (typeof textContent === 'string') {
      text = textContent;
    }

    // Configurar headers SSE
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    
    // Dividir em chunks e enviar
    const chunks = text.match(/[\s\S]{1,30}/g) || [text];
    
    for (const chunk of chunks) {
      const sseData = {
        choices: [
          {
            delta: {
              content: chunk
            }
          }
        ]
      };
      res.write(`data: ${JSON.stringify(sseData)}\n\n`);
    }
    
    // Finalizar
    res.write('data: [DONE]\n\n');
    res.end();
    
  } catch (error) {
    console.error('Erro:', error.message);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    
    const errorMessage = error.message || 'Erro desconhecido';
    const errorData = {
      choices: [
        {
          delta: {
            content: `Desculpe, houve um erro: ${errorMessage}`
          }
        }
      ]
    };
    
    res.write(`data: ${JSON.stringify(errorData)}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  }
});

// Suportar outros endpoints
app.post('/api/completions/stream', (req, res) => {
  req.url = '/api/completions/v1';
  app._router.handle(req, res);
});

app.post('/api/chat/completions', (req, res) => {
  req.url = '/api/completions/v1';
  app._router.handle(req, res);
});

app.post('/api/completions', (req, res) => {
  req.url = '/api/completions/v1';
  app._router.handle(req, res);
});

// CORS preflight
app.options('*', cors());

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
});
