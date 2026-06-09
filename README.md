# Starnest AI Server

Servidor proxy SSE para o aplicativo Horizon Teclado.

## Configuração

### Variáveis de Ambiente

```
MANUS_API_KEY=sua_chave_api_aqui
PORT=3000
```

### Instalação Local

```bash
npm install
npm start
```

## Endpoints

- `POST /api/completions/v1` - Completions com streaming SSE
- `GET /health` - Health check

## Deploy no Render

1. Conecte seu repositório GitHub
2. Configure a variável `MANUS_API_KEY`
3. Deploy automático em cada push

## Formato de Resposta

Todas as respostas são em formato SSE (Server-Sent Events):

```
data: {"choices":[{"delta":{"content":"texto"}}]}
data: [DONE]
```
