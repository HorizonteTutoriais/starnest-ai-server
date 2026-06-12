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

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_API_KEY = process.env.GROQ_API_KEY || '';

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Processar arquivo em base64 (Mantendo sua lógica que funciona)
async function processFile(fileData, fileName, mimeType) {
  try {
    const ext = path.extname(fileName).toLowerCase();
    let buffer;
    if (typeof fileData === 'string' && fileData.includes(',')) {
      buffer = Buffer.from(fileData.split(',')[1], 'base64');
    } else if (typeof fileData === 'string') {
      buffer = Buffer.from(fileData, 'base64');
    } else {
      buffer = fileData;
    }
    
    if (ext === '.txt' || ext === '.md') {
      const content = buffer.toString('utf-8');
      return { type: 'text', description: `[ARQUIVO: ${fileName}]\nConteúdo:\n${content.substring(0, 2000)}` };
    }
    return { type: 'file', description: `[ARQUIVO: ${fileName}] Tamanho: ${(buffer.length / 1024).toFixed(2)} KB` };
  } catch (error) {
    return { type: 'error', description: `Erro: ${error.message}` };
  }
}

// Endpoint principal
app.post(['/api/completions/v1', '/api/chat/completions', '/api/completions'], async (req, res) => {
  try {
    let messages = req.body.messages || [];
    let userMessage = req.body.message || req.body.prompt || req.body.text || '';
    const bodyStr = JSON.stringify(req.body).toLowerCase();
    
    // DETECÇÃO CIRÚRGICA DA GRAMÁTICA AUTOMÁTICA
    const isAutoGrammar = bodyStr.includes('just return the correct result');
    const isGrammarFull = bodyStr.includes('check the grammar') && bodyStr.includes('explanation');

    // Processar arquivos se houver
    if (req.body.file && req.body.fileName) {
      const fileInfo = await processFile(req.body.file, req.body.fileName);
      if (messages.length > 0) {
        messages[messages.length - 1].content += `\n\n${fileInfo.description}`;
      } else {
        messages = [{ role: 'user', content: (userMessage || 'Arquivo') + `\n\n${fileInfo.description}` }];
      }
    }

    // Configurar System Prompt baseado na função
    let systemPrompt = 'Você é um assistente de IA útil. Responda sempre em português (Brasil).';
    let temperature = 0.7;

    if (isAutoGrammar) {
      // PROMPT AGRESSIVO PARA CORREÇÃO AUTOMÁTICA
      systemPrompt = "VOCÊ É UM MOTOR DE CORREÇÃO ORTOGRÁFICA. SUA ÚNICA MISSÃO É CORRIGIR O TEXTO. NÃO DIGA 'Bom trabalho', NÃO DÊ EXPLICAÇÕES. Se houver erro, retorne APENAS o texto corrigido. Se NÃO houver erro, retorne APENAS o texto original. NÃO RESPONDA COM NADA ALÉM DO TEXTO.";
      temperature = 0; // Precisão total
    } else if (isGrammarFull) {
      systemPrompt = "Você é um corretor gramatical. Retorne um JSON com: original, improved e explanation (em português).";
      temperature = 0.2;
    }

    const response = await axios.post(GROQ_API_URL, {
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'system', content: systemPrompt }, ...messages],
      temperature: temperature,
      max_tokens: 1024
    }, {
      headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' }
    });

    let text = response.data.choices[0]?.message?.content || '';

    // LIMPEZA CIRÚRGICA PARA EVITAR O "BOM TRABALHO"
    if (isAutoGrammar) {
      text = text.replace(/^"|"$/g, '').trim();
      // Se a IA ainda assim insistir em ser educada, limpamos as frases comuns
      if (text.toLowerCase().includes("bom trabalho") || text.toLowerCase().includes("gramática está correta")) {
          // Se ela não corrigiu, enviamos o que o usuário escreveu originalmente
          text = messages[messages.length - 1].content;
      }
    }

    // Configurar headers SSE (Mantendo o que funcionou para o seu chat)
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // O segredo: Se for gramática, o teclado espera o JSON dentro da string de resposta
    let finalContent = text;
    if (isAutoGrammar) {
        finalContent = JSON.stringify({ improved: text });
    } else if (isGrammarFull) {
        // Garante que é um JSON válido
        try { JSON.parse(text); finalContent = text; } 
        catch (e) { finalContent = JSON.stringify({ original: "", improved: text, explanation: "Correção aplicada." }); }
    }

    // Enviar em um único chunk para evitar quebra de JSON no teclado
    const sseData = { choices: [{ delta: { content: finalContent } }] };
    res.write(`data: ${JSON.stringify(sseData)}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();

  } catch (error) {
    console.error('Erro:', error.message);
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "Erro na conexão." } }] })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  }
});

app.listen(PORT, () => console.log(`Servidor v9.0 rodando na porta ${PORT}`));
