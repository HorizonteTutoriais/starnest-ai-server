const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');
const AdmZip = require('adm-zip');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Usar API Groq (grátis)
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_API_KEY = process.env.GROQ_API_KEY || '';

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Processar arquivo em base64
async function processFileBase64(fileData, fileName, mimeType) {
  try {
    const ext = path.extname(fileName).toLowerCase();
    
    // Converter base64 para buffer
    let buffer;
    if (typeof fileData === 'string' && fileData.includes(',')) {
      // Data URL format: data:image/png;base64,xxx
      buffer = Buffer.from(fileData.split(',')[1], 'base64');
    } else if (typeof fileData === 'string') {
      // Pure base64
      buffer = Buffer.from(fileData, 'base64');
    } else {
      buffer = fileData;
    }
    
    // Imagens
    if (mimeType && mimeType.startsWith('image/')) {
      return {
        type: 'image',
        content: `[IMAGEM ENVIADA: ${fileName}]\nTamanho: ${(buffer.length / 1024).toFixed(2)} KB\nTipo: ${mimeType}\n\nAnalize ou descreva esta imagem.`,
        description: `Usuário enviou uma imagem: ${fileName}`
      };
    }
    
    // TXT
    if (ext === '.txt' || mimeType === 'text/plain') {
      const content = buffer.toString('utf-8');
      const preview = content.substring(0, 1000);
      return {
        type: 'text',
        content: `[ARQUIVO TXT: ${fileName}]\nTamanho: ${(buffer.length / 1024).toFixed(2)} KB\n\nConteúdo:\n${preview}${content.length > 1000 ? '\n... (truncado)' : ''}`,
        description: `Arquivo TXT: ${fileName}`
      };
    }
    
    // MD
    if (ext === '.md' || mimeType === 'text/markdown') {
      const content = buffer.toString('utf-8');
      const preview = content.substring(0, 1000);
      return {
        type: 'markdown',
        content: `[ARQUIVO MARKDOWN: ${fileName}]\nTamanho: ${(buffer.length / 1024).toFixed(2)} KB\n\nConteúdo:\n${preview}${content.length > 1000 ? '\n... (truncado)' : ''}`,
        description: `Arquivo Markdown: ${fileName}`
      };
    }
    
    // ZIP
    if (ext === '.zip' || mimeType === 'application/zip') {
      try {
        const zip = new AdmZip(buffer);
        const entries = zip.getEntries();
        const fileList = entries.map(e => `  - ${e.entryName} (${(e.header.size / 1024).toFixed(2)} KB)`).join('\n');
        return {
          type: 'zip',
          content: `[ARQUIVO ZIP: ${fileName}]\nTamanho: ${(buffer.length / 1024 / 1024).toFixed(2)} MB\nArquivos: ${entries.length}\n\nConteúdo:\n${fileList.substring(0, 2000)}${fileList.length > 2000 ? '\n... (truncado)' : ''}`,
          description: `Arquivo ZIP: ${fileName} com ${entries.length} arquivos`
        };
      } catch (err) {
        return {
          type: 'zip',
          content: `[ARQUIVO ZIP: ${fileName}]\nErro ao processar: ${err.message}`,
          description: `Arquivo ZIP: ${fileName} (erro ao processar)`
        };
      }
    }
    
    // APK
    if (ext === '.apk' || mimeType === 'application/vnd.android.package-archive') {
      return {
        type: 'apk',
        content: `[APLICATIVO ANDROID: ${fileName}]\nTamanho: ${(buffer.length / 1024 / 1024).toFixed(2)} MB\nTipo: APK (Aplicativo Android)\n\nO usuário enviou um aplicativo Android. Posso ajudar a analisar ou modificar?`,
        description: `Usuário enviou um APK: ${fileName}`
      };
    }
    
    // Outros tipos
    return {
      type: 'file',
      content: `[ARQUIVO: ${fileName}]\nTamanho: ${(buffer.length / 1024).toFixed(2)} KB\nTipo: ${mimeType || 'desconhecido'}\n\nArquivo enviado pelo usuário.`,
      description: `Arquivo: ${fileName}`
    };
  } catch (error) {
    return {
      type: 'error',
      content: `[ERRO AO PROCESSAR ARQUIVO]\nArquivo: ${fileName}\nErro: ${error.message}`,
      description: `Erro ao processar arquivo: ${fileName}`
    };
  }
}

// Endpoint principal para completions
app.post('/api/completions/v1', async (req, res) => {
  try {
    // Extrair mensagem
    let messages = req.body.messages || [];
    let userMessage = req.body.message || req.body.prompt || req.body.text || '';
    let fileContent = '';
    
    // Processar arquivo em base64 se enviado
    if (req.body.file || req.body.fileData) {
      const fileData = req.body.file || req.body.fileData;
      const fileName = req.body.fileName || req.body.filename || 'arquivo';
      const mimeType = req.body.mimeType || req.body.mime_type || 'application/octet-stream';
      
      const fileInfo = await processFileBase64(fileData, fileName, mimeType);
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
  console.log(`Suporta: Imagens, ZIP, TXT, MD, APK (em base64)`);
});
