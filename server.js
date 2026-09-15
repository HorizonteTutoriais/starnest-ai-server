const express = require('express');
const cors = require('cors');
const axios = require('axios');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
const TEXT_MODEL = process.env.GROQ_TEXT_MODEL || 'openai/gpt-oss-20b';
const VISION_MODEL = process.env.GROQ_VISION_MODEL || 'qwen/qwen3.8-27b';
const imageTasks = new Map();

app.use(cors());
app.use(express.json({ limit: '50mb' }));

function sendSSE(res, content) {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
}

function sendCompletionJSON(res, content) {
    res.json({
        data: {
            choices: [{
                message: { role: 'assistant', content }
            }]
        }
    });
}

function normalizeMessages(messages) {
    return messages.map((message) => {
        if (Array.isArray(message.content)) {
            return {
                role: message.role,
                content: message.content.map((part) => {
                    if (part.type === 'text') return part;
                    if (part.type === 'image_url' && part.image_url?.url) {
                        const rawUrl = String(part.image_url.url).trim();
                        if (/^https?:\/\//i.test(rawUrl)) return { type: 'image_url', image_url: { url: rawUrl } };
                        if (/^data:image\//i.test(rawUrl)) {
                            const match = rawUrl.match(/^data:(image\/[a-z0-9.+-]+);base64,(.*)$/is);
                            if (!match) return null;
                            const cleanBase64 = match[2].replace(/\s+/g, '');
                            return { type: 'image_url', image_url: { url: `data:${match[1]};base64,${cleanBase64}` } };
                        }
                        const cleanBase64 = rawUrl.replace(/^base64,?/i, '').replace(/\s+/g, '');
                        return { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${cleanBase64}` } };
                    }
                    return null;
                }).filter(Boolean)
            };
        }
        return { role: message.role, content: String(message.content ?? '') };
    });
}

function detectRequest(messages) {
    const bodyText = JSON.stringify(messages).toLowerCase();
    return {
        grammarCheck: (bodyText.includes('check the grammar') || bodyText.includes('gramática') || bodyText.includes('grammatical')) && bodyText.includes('explanation'),
        autoGrammar: !bodyText.includes('explanation') && (
            bodyText.includes('just return the correct result')
            || bodyText.includes('check grammar')
            || bodyText.includes('check the grammar')
            || bodyText.includes('grammar & spelling')
            || bodyText.includes('gramática e ortografia')
            || bodyText.includes('verifique a gramática')
            || bodyText.includes('confira a gramática')
        ),
        toneChanger: bodyText.includes('tone'),
        professional: bodyText.includes('professional'),
        vision: messages.some((message) => Array.isArray(message.content)
            && message.content.some((part) => part.type === 'image_url'))
    };
}

function hasAutoGrammarSchema(req) {
    const format = JSON.stringify(req.body?.response_format || {}).toLowerCase();
    return format.includes('iscorrect') || format.includes('auto_grammar');
}

async function handleAIFunctions(req, res) {
    try {
        const wantsStream = req.body?.stream === true;
        if (!GROQ_API_KEY) {
            const errorMessage = 'Erro da IA: GROQ_API_KEY não configurada no servidor.';
            return wantsStream ? sendSSE(res, errorMessage) : res.status(503).json({ error: errorMessage });
        }

        const messages = Array.isArray(req.body.messages) ? req.body.messages : [];
        const flags = detectRequest(messages);
        const autoGrammarSchema = hasAutoGrammarSchema(req);
        let systemPrompt = 'Você é um assistente de IA útil. Responda sempre em Português (Brasil).';
        let responseFormat;

        if (flags.grammarCheck) {
            systemPrompt = 'Você é um corretor gramatical. Retorne obrigatoriamente um JSON com as chaves original, improved e explanation. A explicação deve ser em Português (Brasil).';
            responseFormat = { type: 'json_object' };
        } else if (flags.autoGrammar || autoGrammarSchema) {
            systemPrompt = 'Você é um corretor gramatical. Retorne obrigatoriamente um JSON com as chaves improved e isCorrect. improved deve conter somente o texto corrigido. isCorrect deve ser true somente quando o texto original já estiver correto. Não inclua explicações nem outras chaves.';
            responseFormat = { type: 'json_object' };
        } else if (flags.toneChanger) {
            systemPrompt = 'Você altera o tom de textos. Retorne apenas o texto modificado no tom solicitado.';
        } else if (flags.professional) {
            systemPrompt = 'Você é um assistente de e-mail profissional. Melhore o texto para ambiente corporativo e retorne apenas o texto final.';
        }

        const response = await axios.post(GROQ_API_URL, {
            model: flags.vision ? VISION_MODEL : TEXT_MODEL,
            messages: [{ role: 'system', content: systemPrompt }, ...normalizeMessages(messages)],
            ...(responseFormat ? { response_format: responseFormat } : {}),
            temperature: flags.vision ? 0.2 : 0.1,
            max_completion_tokens: flags.vision ? 400 : 2048
        }, {
            headers: {
                Authorization: `Bearer ${GROQ_API_KEY}`,
                'Content-Type': 'application/json'
            },
            timeout: 60000
        });

        const content = response.data?.choices?.[0]?.message?.content;
        if (!content) throw new Error('Resposta vazia do provedor de IA.');
        if (wantsStream) return sendSSE(res, content);
        return sendCompletionJSON(res, content);
    } catch (error) {
        const providerMessage = error.response?.data?.error?.message || error.message;
        console.error('AI Error:', providerMessage);
        const errorMessage = `Erro da IA: ${providerMessage}`;
        if (req.body?.stream === true) return sendSSE(res, errorMessage);
        return res.status(502).json({ error: errorMessage });
    }
}

app.post(['/api/completions/v1', '/api/chat/completions', '/api/completions'], handleAIFunctions);

app.post('/api/image-generator', async (req, res) => {
    try {
        const { prompt, style, size, seed } = req.body;
        const generationId = crypto.randomUUID();
        const taskId = crypto.randomUUID();
        const imageSeed = Number.isInteger(seed) ? seed : Math.floor(Math.random() * 1000000);
        const width = Number(size?.width) || 1024;
        const height = Number(size?.height) || 1024;
        const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(`${prompt || ''}${style ? `, ${style}` : ''}`)}?seed=${imageSeed}&width=${width}&height=${height}&nologo=true`;
        const imageResponse = await axios.get(imageUrl, {
            responseType: 'arraybuffer',
            timeout: 120000
        });
        const base64Image = Buffer.from(imageResponse.data).toString('base64');
        const task = { generationId, taskId, status: 'completed', percentage: '100', imageUrls: [{ url: imageUrl }] };
        imageTasks.set(generationId, task);
        // O APK executa Base64.decode(data), portanto data deve ser Base64 puro, sem prefixo data:.
        res.json({ data: base64Image });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/image-generator/:id', (req, res) => {
    const task = imageTasks.get(req.params.id);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    res.json({ data: task });
});

app.post('/api/upload', (req, res) => {
    res.json({ status: 'success', data: { url: null, message: 'Upload received; imagem processada pelo conteúdo enviado ao endpoint de IA.' } });
});

app.get('/health', (req, res) => res.json({ status: 'ok', textModel: TEXT_MODEL, visionModel: VISION_MODEL }));

app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
