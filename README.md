# Starnest AI Server

Servidor proxy SSE para o aplicativo Horizon Teclado.

## Configuração

Configure no ambiente do deploy:

```env
GROQ_API_KEY=sua_chave_groq
PORT=3000
GROQ_TEXT_MODEL=openai/gpt-oss-20b
GROQ_VISION_MODEL=qwen/qwen3.8-27b
```

`GROQ_TEXT_MODEL` pode ser alterado sem modificar o aplicativo. O modelo de texto padrão é `openai/gpt-oss-20b`, a opção de menor custo do catálogo de produção atual do Groq. O modelo de visão padrão é `qwen/qwen3.8-27b`, que deve ser validado na conta Groq usada pelo deploy porque modelos de prévia podem ter disponibilidade variável. O código não ativa cobrança; a conta Groq deve permanecer sem faturamento habilitado para limitar o uso ao plano gratuito disponível.

## Instalação local

```bash
npm install
npm start
```

## Endpoints usados pelo APK

- `POST /api/completions/v1` — chat, correção gramatical, auto grammar e visão com resposta SSE.
- `POST /api/image-generator` — criação de tarefa de imagem.
- `GET /api/image-generator/:id` — consulta da tarefa de imagem.
- `POST /api/upload` — compatibilidade com o fluxo de envio do aplicativo.
- `GET /health` — health check e identificação dos modelos configurados.

## Formato de resposta SSE

```text
data: {"choices":[{"delta":{"content":"texto"}}]}

data: [DONE]
```

## Observações

O aplicativo envia as imagens como conteúdo multimodal no endpoint de completions. O servidor preserva as partes `text` e `image_url` antes de encaminhá-las ao modelo de visão. Para produção, valide o modelo de visão com a chave Groq do deploy antes de publicar uma nova versão do APK.
