# PromptShip

AI full-stack app builder: describe an app in plain English and PromptShip plans it, streams the code file by file, runs it in a sandboxed live preview with its own database-backed API, and publishes it to a public URL.

> Work in progress. See [docs/PLAN.md](docs/PLAN.md) for the architecture and roadmap.

## Quick start (local)

Requirements: Node 22+, Docker.

```bash
docker compose up -d          # Postgres on :5432 (creates promptship + promptship_test)
cp .env.example .env          # set SESSION_SECRET; add OPENAI_API_KEY (optional: mock LLM works without it)
npm install
npm run dev                   # http://localhost:3000
```

Production build: `npm run build && npm start`.
