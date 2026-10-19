# FISEN Technologies AI Assistant (Production Ready)

Enterprise AI Assistant with Retrieval-Augmented Generation (RAG) powered by Pinecone vector storage, Ollama embeddings, and Groq ultra-fast LLM inference.

---

## 🚀 Features

- **Enterprise Knowledge Base**: Indexes the comprehensive FISEN Company Profile into 768-dimensional vectors with Pinecone serverless.
- **Ultra-Fast Answers**: Uses Groq LLM inference (`openai/gpt-oss-20b`) for fast response times.
- **Production Hardened**:
  - **Security**: Strict HTTP security headers via `helmet` and custom Content Security Policy (CSP).
  - **Abuse Prevention**: Rate-limiting (default 60 requests/15m per IP) with reverse proxy support (`trust proxy`).
  - **Self-Contained Frontend**: Bundled client vendor libraries (`marked.js`, `DOMPurify`), responsive dark UI, official FISEN branding.
  - **Clean Executive Output**: Formatted markdown with bold terms and bullet points, zero internal page numbers or citations.
  - **Resilience**: Graceful shutdown handlers (`SIGTERM`, `SIGINT`) and health check endpoints (`/api/health`).

---

## 🛠 Prerequisites

- **Node.js**: v18.0.0 or higher (v20+ recommended).
- **Ollama**: Running locally or reachable over network (`http://localhost:11434`) with `nomic-embed-text` pulled:
  ```bash
  ollama pull nomic-embed-text
  ```
- **Pinecone Account**: Free or paid serverless account with an API key.
- **Groq Account**: Free or enterprise API key.

---

## ⚙️ Configuration (`.env`)

Copy `.env.example` in `backend/` to `backend/.env` and fill in your keys:

```bash
cd backend
cp .env.example .env
```

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Port for the HTTP server |
| `HOST` | `0.0.0.0` | Bind host address |
| `NODE_ENV` | `production` | Node environment |
| `TRUST_PROXY` | `false` | Set `true` when behind Nginx, Traefik, Cloudflare, or AWS ALB |
| `CORS_ORIGIN` | `*` | Allowed origins (e.g. `https://fisen.com`) |
| `RATE_LIMIT_MAX`| `60` | Max requests per 15 min per IP on `/api/chat` |
| `GROQ_API_KEY` | *(Required)* | Groq API Key |
| `GROQ_MODEL` | `openai/gpt-oss-20b` | Groq chat model |
| `PINECONE_API_KEY` | *(Required)* | Pinecone API Key |
| `PINECONE_INDEX` | `companychat-local` | Pinecone index name |
| `PINECONE_CLOUD` | `aws` | Cloud provider |
| `PINECONE_REGION` | `us-east-1` | Cloud region |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama service endpoint |
| `EMBEDDING_MODEL` | `nomic-embed-text` | Embedding model (768 dim) |

---

## 📦 Ingesting / Indexing PDF Documents

To index the company profile into Pinecone:

```bash
cd backend
npm run index:profile
```

---

## 🚢 Deployment Methods

### Option 1: Docker & Docker Compose (Recommended)

```bash
cd backend
docker compose up -d --build
```

To view logs:
```bash
docker compose logs -f
```

### Option 2: PM2 (Node.js Process Manager)

Best for Linux / Cloud VPS (AWS EC2, DigitalOcean, Ubuntu):

```bash
cd backend
npm install -g pm2
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

### Option 3: Direct Node Execution

```bash
cd backend
npm ci --omit=dev
npm start
```

---

## 🩺 Health Check & Monitoring

Check the status of the service anytime:

```bash
curl -i http://localhost:3000/api/health
```

Expected JSON response:
```json
{
  "status": "ok",
  "service": "FISEN Technologies AI Agent",
  "timestamp": "2026-10-19T15:46:26.428Z"
}
```
