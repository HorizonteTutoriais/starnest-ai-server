const express = require('express');
const cors = require('cors');
const axios = require('axios');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Configurar multer para upload de arquivos
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB
});

// Usar API Groq (grátis)
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_API_KEY = process.env.GROQ_API_KEY || '';

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Processar arquivo enviado
async function processFile(file) {
  try {
    const ext = path.extname(file.originalname).toLowerCase();
    const mimeType = file.mimetype;
    
    // Imagens: converter para base64 e descrever
    if (mimeType.startsWith('image/')) {
      const base64 = file.buffer.toString('base64');
      return {
        type: 'image',
        content: `[IMAGEM ENVIADA: ${file.originalname}]\nTamanho: ${(file.size / 1024).toFixed(2)} KB\nTipo: ${mimeType}\n\nDescreva ou analise esta imagem.`,
        description: `Usuário enviou uma imagem: ${file.originalname}`
      };
    }
    
    // TXT: ler conteúdo
    if (ext === '.txt') {
      const content = file.buffer.toString('utf-8');
      const preview = content.substring(0, 1000);
      return {
        type: 'text',
        content: `[ARQUIVO TXT: ${file.originalname}]\nTamanho: ${(file.size / 1024).toFixed(2)} KB\n\nConteúdo:\n${preview}${content.length > 1000 ? '\n... (truncado)' : ''}`,
        description: `Arquivo TXT: ${file.originalname}`
      };
    }
    
    // MD: ler conteúdo
    if (ext === '.md') {
      const content = file.buffer.toString('utf-8');
      const preview = content.substring(0, 1000);
      return {
        type: 'markdown',
        content: `[ARQUIVO MARKDOWN: ${file.originalname}]\nTamanho: ${(file.size / 1024).toFixed(2)} KB\n\nConteúdo:\n${preview}${content.length > 1000 ? '\n... (truncado)' : ''}`,
        description: `Arquivo Markdown: ${file.originalname}`
      };
    }
    
    // ZIP: listar conteúdo
    if (ext === '.zip' || mimeType === 'application/zip') {
      try {
        const zip = new AdmZip(file.buffer);
        const entries = zip.getEntries();
        const fileList = entries.map(e => `  - ${e.entryName} (${(e.header.size / 1024).toFixed(2)} KB)`).join('\n');
        return {
          type: 'zip',
          content: `[ARQUIVO ZIP: ${file.originalname}]\nTamanho: ${(file.size / 1024 / 1024).toFixed(2)} MB\nArquivos: ${entries.length}\n\nConteúdo:\n${fileList.substring(0, 2000)}${fileList.length > 2000 ? '\n... (truncado)' : ''}`,
          description: `Arquivo ZIP: ${file.originalname} com ${entries.length} arquivos`
        };
      } catch (err) {
        return {
          type: 'zip',
          content: `[ARQUIVO ZIP: ${file.originalname}]\nErro ao processar: ${err.message}`,
          description: `Arquivo ZIP: ${file.originalname} (erro ao processar)`
        };
      }
    }
    
    // APK: informações básicas
    if (ext === '.apk' || mimeType === 'application/vnd.android.package-archive') {
      return {
        type: 'apk',
        content: `[APLICATIVO ANDROID: ${file.originalname}]\nTamanho: ${(file.size / 1024 / 1024).toFixed(2)} MB\nTipo: APK (Aplicativo Android)\n\nO usuário enviou um aplicativo Android.`,
        description: `Usuário enviou um APK: ${file.originalname}`
      };
    }
    
    // Outros tipos de arquivo
    return {
      type: 'file',
      content: `[ARQUIVO: ${file.originalname}]\nTamanho: ${(file.size / 1024).toFixed(2)} KB\nTipo: ${mimeType}\n\nArquivo enviado pelo usuário.`,
      description: `Arquivo: ${file.originalname}`
    };
  } catch (error) {
    return {
      type: 'error',
      content: `[ERRO AO PROCESSAR ARQUIVO]\nArquivo: ${file.originalname}\nErro: ${error.message}`,
      description: `Erro ao processar arquivo: ${file.originalname}`
    };
  }
}

// Endpoint principal para completions
app.post('/api/completions/v1', upload.single('file'), async (req, res) => {
  try {
    // Extrair mensagem
    let messages = req.body.messages || [];
    let userMessage = req.body.message || req.body.prompt || req.body.text || '';
    let fileContent = '';
    
    // Processar arquivo se enviado
    if (req.file) {
      const fileInfo = await processFile(req.file);
      fileContent = `\n\n${fileInfo.content}`;
      if (!userMessage) {
        userMessage = fileInfo.description;
      }
    }
    
    if (!Array.isArray(messages) || messages.length === 0) {
      if (userMessage || fileContent) {
        messages = [{ role: 'user', content: (userMessage || 'Arquivo enviado') + fileContent }];
      } else {
        userMessage = 'Olá';
        messages = [{ role: 'user', content: userMessage }];
      }
    } else {
      // Se tem mensagens, adicionar conteúdo do arquivo à última mensagem
      if (fileContent && messages.length > 0) {
        const lastMsg = messages[messages.length - 1];
        if (lastMsg.role === 'user') {
          lastMsg.content = (lastMsg.content || '') + fileContent;
        }
      }
    }

    // Adicionar system prompt
    const messagesWithSystem = [
      {
        role: 'system',
        content: 'Você é um assistente de IA útil. IMPORTANTE: Sempre responda em português (Brasil). Todas as suas respostas devem ser em português. Quando o usuário enviar arquivos (imagens, textos, etc.), analise e responda sobre o conteúdo.'
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
app.post('/api/completions/stream', upload.single('file'), (req, res) => {
  req.url = '/api/completions/v1';
  app._router.handle(req, res);
});

app.post('/api/chat/completions', upload.single('file'), (req, res) => {
  req.url = '/api/completions/v1';
  app._router.handle(req, res);
});

app.post('/api/completions', upload.single('file'), (req, res) => {
  req.url = '/api/completions/v1';
  app._router.handle(req, res);
});

// CORS preflight
app.options('*', cors());

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`Suporta: Imagens, ZIP, TXT, MD, APK`);
});
