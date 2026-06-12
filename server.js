const express = require('express');
const cors = require('cors');
const axios = require('axios');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Configurações de API
// Usaremos GROQ como principal por ser rápido e gratuito para testes, 
// mas os formatos de resposta serão adaptados para o que o APK espera.
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_API_KEY = process.env.GROQ_API_KEY || '';

// Cache em memória para tarefas de imagem (Polling)
const imageTasks = new Map();

// --- HELPER: Formatação de Resposta SSE ---
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

// --- ENDPOINTS DE GRAMÁTICA E TEXTO ---

async function handleAIFunctions(req, res) {
    try {
        const bodyStr = JSON.stringify(req.body).toLowerCase();
        const messages = req.body.messages || [];
        const lastMessage = messages.length > 0 ? messages[messages.length - 1].content : '';
        
        // 1. Identificar o tipo de função pelo conteúdo do prompt (O APK envia prompts específicos)
        const isGrammarCheck = bodyStr.includes('check the grammar') && bodyStr.includes('explanation');
        const isAutoGrammar = bodyStr.includes('just return the correct result');
        const isToneChanger = bodyStr.includes('tone');
        const isProfessional = bodyStr.includes('professional');
        const isVision = messages.some(m => Array.isArray(m.content) && m.content.some(c => c.type === 'image_url'));

        let systemPrompt = "Você é um assistente de IA útil. Responda sempre em Português (Brasil).";
        let forceJson = false;

        if (isGrammarCheck) {
            systemPrompt = `Você é um corretor gramatical. Analise o texto e retorne OBRIGATORIAMENTE um JSON com:
            {
              "original": "texto original",
              "improved": "texto corrigido",
              "explanation": "breve explicação do erro"
            }`;
            forceJson = true;
        } else if (isAutoGrammar) {
            systemPrompt = "Você é um corretor gramatical. Retorne APENAS o texto corrigido, sem nenhuma explicação ou aspas.";
        } else if (isToneChanger) {
            systemPrompt = "Você altera o tom de textos. Retorne APENAS o texto modificado no tom solicitado.";
        } else if (isProfessional) {
            systemPrompt = "Você é um assistente de e-mail profissional. Melhore o texto para um ambiente corporativo. Retorne apenas o texto final.";
        }

        // Chamada para o Groq (ou OpenAI)
        const response = await axios.post(GROQ_API_URL, {
            model: isVision ? "llama-3.2-11b-vision-preview" : "llama-3.3-70b-versatile",
            messages: [
                { role: "system", content: systemPrompt },
                ...messages.map(m => ({
                    role: m.role,
                    content: typeof m.content === 'string' ? m.content : (Array.isArray(m.content) ? m.content.filter(c => c.type === 'text').map(c => c.text).join(' ') : JSON.stringify(m.content))
                }))
            ],
            response_format: forceJson ? { type: "json_object" } : undefined,
            temperature: 0.2
        }, {
            headers: { 'Authorization': `Bearer ${GROQ_API_KEY}` }
        });

        let aiContent = response.data.choices[0].message.content;

        // O APK espera as respostas via SSE (Stream) no endpoint de completions
        sendSSE(res, aiContent);

    } catch (error) {
        console.error("AI Error:", error.message);
        sendSSE(res, "Desculpe, tive um problema técnico. Tente novamente.");
    }
}

app.post(['/api/completions/v1', '/api/chat/completions', '/api/completions'], handleAIFunctions);

// --- ENDPOINTS DE IMAGEM (GERADOR) ---

app.post('/api/image-generator', async (req, res) => {
    try {
        const { prompt, style } = req.body;
        const generationId = crypto.randomUUID();
        const taskId = crypto.randomUUID();

        // Usamos Pollinations AI (Gratuito e rápido)
        const seed = Math.floor(Math.random() * 1000000);
        const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt + ", " + (style || "")) }?seed=${seed}&width=1024&height=1024&nologo=true`;

        // Salva para o Polling
        imageTasks.set(generationId, {
            generationId,
            taskId,
            status: 'completed',
            percentage: '100',
            imageUrls: [{ url: imageUrl }]
        });

        // O APK espera o formato: { data: { generationId, taskId, ... } }
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

// --- ENDPOINT DE UPLOAD (OCR / VISÃO) ---
app.post('/api/upload', (req, res) => {
    // O APK chama esse endpoint antes de enviar imagens para a IA
    res.json({
        status: "success",
        data: {
            url: "https://via.placeholder.com/150", // Placeholder, o app usa o base64 local
            message: "Upload successful"
        }
    });
});

app.get('/health', (req, res) => res.json({ status: "ok" }));

app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
