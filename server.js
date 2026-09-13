const express = require('express');
const cors = require('cors');
const axios = require('axios');
const crypto = require('crypto');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Groq - OpenAI compatible API.
// Qwen 3.6 27B supports text + vision and is the single model used here
// for chat, grammar, correction, tone and image understanding.
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
const GROQ_MODEL = process.env.GROQ_MODEL || 'qwen/qwen3.6-27b';

// Image generation remains compatible with the APK's existing polling flow.
const imageTasks = new Map();

// Accept multipart uploads if the APK uses /api/upload.
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 20 * 1024 * 1024 }
});

function setSSEHeaders(res) {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();
}

function sendSSE(res, content) {
    setSSEHeaders(res);
    const data = { choices: [{ delta: { content: String(content ?? '') } }] };
    res.write(`data: ${JSON.stringify(data)}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
}

function sendSSEError(res, message, status = 500) {
    if (!res.headersSent) res.status(status);
    sendSSE(res, message);
}

function extractText(content) {
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) return content == null ? '' : JSON.stringify(content);

    return content
        .filter(part => part && part.type === 'text')
        .map(part => part.text || '')
        .join('\n');
}

function hasImage(messages) {
    return messages.some(message =>
        Array.isArray(message?.content) &&
        message.content.some(part => part?.type === 'image_url' && part?.image_url?.url)
    );
}

function normalizeMessages(messages) {
    if (!Array.isArray(messages)) return [];

    return messages
        .filter(m => m && m.role)
        .map(m => ({
            role: m.role,
            // IMPORTANT: preserve image_url objects. The old server removed them,
            // which made OCR/image understanding impossible.
            content: Array.isArray(m.content)
                ? m.content.map(part => {
                    if (part?.type === 'image_url') {
                        return {
                            type: 'image_url',
                            image_url: { url: part.image_url.url }
                        };
                    }
                    if (part?.type === 'text') {
                        return { type: 'text', text: String(part.text || '') };
                    }
                    return part;
                })
                : String(m.content ?? '')
        }));
}

function detectFunction(reqBody) {
    const raw = JSON.stringify(reqBody || '').toLowerCase();
    return {
        grammarExplanation:
            raw.includes('check the grammar') && raw.includes('explanation'),
        autoGrammar:
            raw.includes('just return the correct result'),
        tone:
            raw.includes('tone'),
        professional:
            raw.includes('professional'),
        synonym:
            raw.includes('synonym'),
        image: hasImage(reqBody?.messages || [])
    };
}

function buildSystemPrompt(flags) {
    if (flags.grammarExplanation) {
        return `Você é um corretor gramatical e ortográfico extremamente cuidadoso.\n\n` +
            `Analise o texto recebido e responda OBRIGATORIAMENTE como JSON válido, sem markdown, ` +
            `usando exatamente estas propriedades:\n` +
            `{"original":"texto original","improved":"texto corrigido","explanation":"explicação breve"}\n\n` +
            `Preserve o significado e o idioma original. Para português, use português do Brasil.`;
    }

    if (flags.autoGrammar) {
        return `Você é o corretor ortográfico e gramatical automático do teclado. ` +
            `Corrija ortografia, acentuação, pontuação e gramática. ` +
            `Preserve o significado, o estilo e o idioma original. ` +
            `Retorne APENAS o texto corrigido, sem explicações, sem aspas e sem markdown.`;
    }

    if (flags.synonym) {
        return `Você é um assistente de escrita. Forneça sinônimos adequados ao contexto solicitado. ` +
            `Mantenha o idioma original e seja direto.`;
    }

    if (flags.tone) {
        return `Você altera o tom de textos. Preserve o significado e as informações originais. ` +
            `Retorne apenas o texto final, sem explicações e sem markdown.`;
    }

    if (flags.professional) {
        return `Você é um assistente profissional de escrita. Melhore o texto para comunicação profissional, ` +
            `preservando o significado. Retorne apenas o texto final, sem explicações e sem markdown.`;
    }

    if (flags.image) {
        return `Você é um assistente multimodal. Analise cuidadosamente a imagem recebida. ` +
            `Quando o usuário pedir para extrair texto, transcreva o texto visível com a maior fidelidade possível. ` +
            `Quando pedir para explicar, analisar ou responder sobre a imagem, use somente informações realmente ` +
            `observáveis nela e deixe claro quando algo não puder ser identificado. Responda em português do Brasil ` +
            `quando o usuário estiver falando português.`;
    }

    return `Você é o assistente de IA do Horizon Teclado. Seja útil, preciso e direto. ` +
        `Responda no idioma do usuário. Quando o usuário escrever em português, use português do Brasil.`;
}

function getGroqError(error) {
    const status = error?.response?.status;
    const data = error?.response?.data;
    if (data?.error?.message) return `Groq ${status || ''}: ${data.error.message}`.trim();
    if (typeof data === 'string' && data) return `Groq ${status || ''}: ${data}`.trim();
    return error?.message || 'Erro desconhecido ao consultar a Groq.';
}

async function callGroq(messages, options = {}) {
    if (!GROQ_API_KEY) {
        const err = new Error('GROQ_API_KEY não configurada no Render.');
        err.statusCode = 500;
        throw err;
    }

    const payload = {
        model: GROQ_MODEL,
        messages,
        temperature: options.temperature ?? 0.2
    };

    if (options.responseFormat) payload.response_format = options.responseFormat;
    if (options.maxTokens) payload.max_tokens = options.maxTokens;

    const response = await axios.post(GROQ_API_URL, payload, {
        headers: {
            Authorization: `Bearer ${GROQ_API_KEY}`,
            'Content-Type': 'application/json'
        },
        timeout: 120000,
        validateStatus: () => true
    });

    if (response.status < 200 || response.status >= 300) {
        const err = new Error(response.data?.error?.message || `Groq HTTP ${response.status}`);
        err.response = response;
        throw err;
    }

    return response.data;
}

async function handleAIFunctions(req, res) {
    try {
        const messages = normalizeMessages(req.body?.messages || []);
        const flags = detectFunction(req.body);
        const systemPrompt = buildSystemPrompt(flags);

        if (!messages.length) {
            return sendSSEError(res, 'Nenhuma mensagem foi enviada.', 400);
        }

        const response = await callGroq([
            { role: 'system', content: systemPrompt },
            ...messages
        ], {
            temperature: flags.grammarExplanation || flags.autoGrammar ? 0.1 : 0.2,
            responseFormat: flags.grammarExplanation ? { type: 'json_object' } : undefined
        });

        const aiContent = response?.choices?.[0]?.message?.content;
        if (!aiContent) throw new Error('A Groq retornou uma resposta vazia.');

        sendSSE(res, aiContent);
    } catch (error) {
        const message = getGroqError(error);
        console.error('[AI ERROR]', message);
        sendSSEError(res, `Erro da IA: ${message}`);
    }
}

app.post(['/api/completions/v1', '/api/chat/completions', '/api/completions'], handleAIFunctions);

// --- IMAGE GENERATION ---
// Kept compatible with the APK's existing generationId/taskId polling flow.
app.post('/api/image-generator', async (req, res) => {
    try {
        const prompt = String(req.body?.prompt || '').trim();
        const style = String(req.body?.style || '').trim();

        if (!prompt) return res.status(400).json({ error: 'Prompt vazio.' });

        const generationId = crypto.randomUUID();
        const taskId = crypto.randomUUID();
        const seed = Math.floor(Math.random() * 1000000);
        const fullPrompt = [prompt, style].filter(Boolean).join(', ');
        const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(fullPrompt)}?seed=${seed}&width=1024&height=1024&nologo=true`;

        const task = {
            generationId,
            taskId,
            status: 'completed',
            percentage: '100',
            imageUrls: [{ url: imageUrl }]
        };

        imageTasks.set(generationId, task);
        res.json({ data: task });
    } catch (error) {
        console.error('[IMAGE ERROR]', error.message);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/image-generator/:id', (req, res) => {
    const task = imageTasks.get(req.params.id);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    res.json({ data: task });
});

// --- UPLOAD / IMAGE TO BASE64 ---
// Supports both multipart/form-data and JSON/base64.
app.post('/api/upload', upload.single('file'), (req, res) => {
    try {
        if (req.file) {
            const mime = req.file.mimetype || 'image/jpeg';
            const base64 = req.file.buffer.toString('base64');
            const dataUrl = `data:${mime};base64,${base64}`;
            return res.json({
                status: 'success',
                data: { url: dataUrl, message: 'Upload successful' }
            });
        }

        const possible = req.body?.file || req.body?.image || req.body?.base64 || req.body?.data;
        if (typeof possible === 'string' && possible.length > 20) {
            const dataUrl = possible.startsWith('data:')
                ? possible
                : `data:image/jpeg;base64,${possible}`;
            return res.json({
                status: 'success',
                data: { url: dataUrl, message: 'Upload successful' }
            });
        }

        // Keep compatibility with APK callers that only use this endpoint as a handshake.
        res.json({
            status: 'success',
            data: { url: '', message: 'Upload successful' }
        });
    } catch (error) {
        console.error('[UPLOAD ERROR]', error.message);
        res.status(500).json({ status: 'error', error: error.message });
    }
});

// Groq does not expose an embeddings endpoint compatible with the old APK path.
// Return a clean response instead of pretending an embedding was generated.
app.post('/api/embeddings', (req, res) => {
    res.status(501).json({
        error: {
            message: 'Embeddings are not implemented by this Groq-backed server.'
        }
    });
});

app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        groqConfigured: Boolean(GROQ_API_KEY),
        model: GROQ_MODEL,
        vision: true,
        endpoints: [
            '/api/completions/v1',
            '/api/chat/completions',
            '/api/completions',
            '/api/image-generator',
            '/api/upload',
            '/api/embeddings'
        ]
    });
});

app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
    console.log(`Modelo Groq: ${GROQ_MODEL}`);
    console.log(`GROQ_API_KEY configurada: ${Boolean(GROQ_API_KEY)}`);
});
