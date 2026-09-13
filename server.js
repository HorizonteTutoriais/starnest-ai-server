const express = require('express');
const cors = require('cors');
const axios = require('axios');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_API_KEY = process.env.GROQ_API_KEY || '';

// Modelo atual do Groq para texto e imagens
const GROQ_MODEL = 'qwen/qwen3.6-27b';

const imageTasks = new Map();

function sendSSE(res, content) {
    if (!res.headersSent) {
        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
    }

    const sseData = {
        choices: [
            {
                delta: {
                    content: String(content || '')
                }
            }
        ]
    };

    res.write(`data: ${JSON.stringify(sseData)}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
}

function getErrorMessage(error) {
    const apiMessage = error?.response?.data?.error?.message;

    if (apiMessage) {
        return apiMessage;
    }

    if (error?.response?.status) {
        return `Groq HTTP ${error.response.status}: ${error.message}`;
    }

    return error?.message || 'Erro desconhecido';
}

function extractQuotedInput(text, patterns) {
    for (const re of patterns) {
        const match = text.match(re);

        if (match && match[1] != null) {
            return match[1];
        }
    }

    return '';
}

function cleanJsonContent(text) {
    let value = String(text || '').trim();

    if (value.startsWith('```')) {
        value = value
            .replace(/^```(?:json)?\s*/i, '')
            .replace(/\s*```$/i, '')
            .trim();
    }

    const first = value.indexOf('{');
    const last = value.lastIndexOf('}');

    if (first >= 0 && last > first) {
        value = value.slice(first, last + 1);
    }

    return value;
}

async function handleAIFunctions(req, res) {
    try {
        if (!GROQ_API_KEY) {
            return sendSSE(
                res,
                'Erro: a variável GROQ_API_KEY não está configurada no Render.'
            );
        }

        const messages = Array.isArray(req.body.messages)
            ? req.body.messages
            : [];

        const bodyStr = JSON.stringify(req.body);
        const lower = bodyStr.toLowerCase();

        const allText = messages
            .map(message => {
                if (typeof message?.content === 'string') {
                    return message.content;
                }

                if (Array.isArray(message?.content)) {
                    return message.content
                        .filter(item => item?.type === 'text')
                        .map(item => item.text || '')
                        .join(' ');
                }

                return '';
            })
            .join('\n');

        const lowerText = allText.toLowerCase();

        /*
         * CORRETOR GRAMATICAL
         */

        const isDetailedGrammar =
            lowerText.includes(
                'check the grammar & spelling below text:'
            ) &&
            lowerText.includes(
                'explanation must be returned'
            );

        const isAutoGrammar =
            lowerText.includes(
                'check grammar for this text:'
            ) &&
            lowerText.includes(
                'just return the correct result'
            );

        const isGrammar =
            isDetailedGrammar || isAutoGrammar;

        const isToneChanger =
            lower.includes('tone');

        const isProfessional =
            lower.includes('professional');

        const isVision = messages.some(
            message =>
                Array.isArray(message?.content) &&
                message.content.some(
                    item => item?.type === 'image_url'
                )
        );

        let systemPrompt =
            'Você é um assistente de IA útil. Responda no mesmo idioma do usuário.';

        let forceJson = false;
        let originalInput = '';

        /*
         * CORRETOR COM EXPLICAÇÃO
         */

        if (isDetailedGrammar) {
            originalInput = extractQuotedInput(allText, [
                /Check the grammar & spelling below text:\s*'([\s\S]*?)'\.\s*The Explanation/i
            ]);

            systemPrompt = `
Você é um corretor ortográfico e gramatical extremamente rigoroso.

Analise cuidadosamente o texto fornecido.

Você DEVE verificar:

- erros de ortografia;
- palavras escritas incorretamente;
- acentuação;
- pontuação;
- concordância verbal;
- concordância nominal;
- gramática;
- palavras faltando;
- palavras desnecessárias;
- construção das frases;
- erros de digitação.

Se encontrar qualquer erro, corrija.

Se o texto estiver realmente correto, mantenha o texto original.

NÃO considere um texto correto simplesmente porque ele é compreensível.

NÃO invente erros quando não existem.

Retorne SOMENTE um objeto JSON válido com exatamente estas propriedades:

{
  "original": "texto original",
  "improved": "texto corrigido",
  "explanation": "explicação das correções"
}

O campo "original" deve conter exatamente o texto original.

O campo "improved" deve conter o texto corrigido.

O campo "explanation" deve explicar claramente os erros encontrados e as correções realizadas.

Se não houver erros, explique que nenhuma correção foi necessária.

Preserve o idioma original do texto.

Texto original exato:
${JSON.stringify(originalInput)}
`;

            forceJson = true;
        }

        /*
         * CORRETOR AUTOMÁTICO
         */

        else if (isAutoGrammar) {
            originalInput = extractQuotedInput(allText, [
                /Check grammar for this text:\s*'([\s\S]*?)'\s*,?\s*just return the correct result/i
            ]);

            systemPrompt = `
Você é um corretor ortográfico e gramatical rigoroso.

Corrija o texto abaixo.

Verifique obrigatoriamente:

- ortografia;
- erros de digitação;
- acentuação;
- pontuação;
- concordância;
- gramática;
- construção das frases.

Se houver qualquer erro, CORRIJA.

Se o texto estiver correto, retorne exatamente o mesmo texto.

Retorne SOMENTE o texto corrigido.

NÃO escreva explicações.

NÃO escreva "está correto".

NÃO escreva "texto correto".

NÃO coloque aspas.

NÃO coloque comentários.

Preserve o idioma original.

Texto:
${JSON.stringify(originalInput)}
`;
        }

        /*
         * ALTERAÇÃO DE TOM
         */

        else if (isToneChanger) {
            systemPrompt =
                'Você altera o tom de textos. Retorne APENAS o texto modificado no tom solicitado.';
        }

        /*
         * TEXTO PROFISSIONAL
         */

        else if (isProfessional) {
            systemPrompt =
                'Você é um assistente de escrita profissional. Melhore o texto para um ambiente profissional. Retorne apenas o texto final.';
        }

        /*
         * PREPARA AS MENSAGENS
         */

        const normalizedMessages = messages.map(message => {
            let content = message?.content;

            if (Array.isArray(content)) {
                content = content
                    .filter(
                        item =>
                            item?.type === 'text' ||
                            item?.type === 'image_url'
                    )
                    .map(item => {
                        if (item.type === 'text') {
                            return {
                                type: 'text',
                                text: String(item.text || '')
                            };
                        }

                        return {
                            type: 'image_url',
                            image_url: {
                                url:
                                    item?.image_url?.url ||
                                    ''
                            }
                        };
                    })
                    .filter(item => {
                        if (item.type === 'text') {
                            return item.text.length > 0;
                        }

                        return item.image_url.url.length > 0;
                    });
            }

            else if (typeof content !== 'string') {
                content = JSON.stringify(content ?? '');
            }

            return {
                role: message?.role || 'user',
                content
            };
        });

        /*
         * ENVIA PARA O GROQ
         */

        const requestBody = {
            model: GROQ_MODEL,

            messages: [
                {
                    role: 'system',
                    content: systemPrompt
                },
                ...normalizedMessages
            ],

            temperature: isGrammar
                ? 0.0
                : 0.2
        };

        if (forceJson) {
            requestBody.response_format = {
                type: 'json_object'
            };
        }

        const response = await axios.post(
            GROQ_API_URL,
            requestBody,
            {
                headers: {
                    Authorization:
                        `Bearer ${GROQ_API_KEY}`,

                    'Content-Type':
                        'application/json'
                },

                timeout: 120000
            }
        );

        let aiContent =
            response?.data?.choices?.[0]?.message?.content;

        if (!aiContent) {
            throw new Error(
                'A Groq não retornou conteúdo na resposta.'
            );
        }

        /*
         * GARANTE JSON CORRETO PARA O APK
         */

        if (isDetailedGrammar) {
            try {
                const parsed = JSON.parse(
                    cleanJsonContent(aiContent)
                );

                const improved =
                    typeof parsed.improved === 'string'
                        ? parsed.improved
                        : originalInput;

                const explanation =
                    typeof parsed.explanation === 'string'
                        ? parsed.explanation
                        : '';

                aiContent = JSON.stringify({
                    original: originalInput,

                    improved: improved,

                    explanation:
                        explanation ||
                        (
                            improved === originalInput
                                ? 'Nenhum erro gramatical ou ortográfico foi encontrado.'
                                : 'Texto corrigido.'
                        )
                });
            }

            catch (error) {
                console.error(
                    'Erro ao interpretar JSON do corretor:',
                    error.message
                );

                aiContent = JSON.stringify({
                    original: originalInput,

                    improved: originalInput,

                    explanation:
                        'Não foi possível interpretar a resposta do corretor.'
                });
            }
        }

        /*
         * DEVOLVE A RESPOSTA PARA O APK
         */

        sendSSE(res, aiContent);
    }

    catch (error) {
        const message =
            getErrorMessage(error);

        console.error(
            'AI Error:',
            message
        );

        sendSSE(
            res,
            `Erro da IA: ${message}`
        );
    }
}

/*
 * ENDPOINTS DA IA
 */

app.post(
    [
        '/api/completions/v1',
        '/api/chat/completions',
        '/api/completions'
    ],
    handleAIFunctions
);

/*
 * GERADOR DE IMAGENS
 */

app.post(
    '/api/image-generator',
    async (req, res) => {
        try {
            const {
                prompt,
                style
            } = req.body;

            const generationId =
                crypto.randomUUID();

            const taskId =
                crypto.randomUUID();

            const seed =
                Math.floor(
                    Math.random() * 1000000
                );

            const imageUrl =
                `https://image.pollinations.ai/prompt/${encodeURIComponent(
                    `${prompt || ''}, ${style || ''}`
                )}?seed=${seed}&width=1024&height=1024&nologo=true`;

            const task = {
                generationId,
                taskId,
                status: 'completed',
                percentage: '100',
                imageUrls: [
                    {
                        url: imageUrl
                    }
                ]
            };

            imageTasks.set(
                generationId,
                task
            );

            res.json({
                data: task
            });
        }

        catch (error) {
            res.status(500).json({
                error: error.message
            });
        }
    }
);

/*
 * CONSULTA DO GERADOR DE IMAGENS
 */

app.get(
    '/api/image-generator/:id',
    (req, res) => {
        const task =
            imageTasks.get(
                req.params.id
            );

        if (!task) {
            return res.status(404).json({
                error: 'Task not found'
            });
        }

        res.json({
            data: task
        });
    }
);

/*
 * UPLOAD
 */

app.post(
    '/api/upload',
    (req, res) => {
        res.json({
            status: 'success',

            data: {
                url:
                    'https://via.placeholder.com/150',

                message:
                    'Upload successful'
            }
        });
    }
);

/*
 * HEALTH CHECK
 */

app.get(
    '/health',
    (req, res) => {
        res.json({
            status: 'ok',

            groqConfigured:
                Boolean(GROQ_API_KEY),

            model:
                GROQ_MODEL
        });
    }
);

/*
 * INICIA O SERVIDOR
 */

app.listen(
    PORT,
    () => {
        console.log(
            `Servidor rodando na porta ${PORT}`
        );

        console.log(
            `Modelo Groq: ${GROQ_MODEL}`
        );
    }
);
