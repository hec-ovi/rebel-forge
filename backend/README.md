# Rebel Forge Backend

Local-first backend for a single logical client: one creator or one brand workspace.

The architecture is intentionally narrow:

- Python modular monolith
- FastAPI API
- Postgres persistence
- one worker process
- OpenAI-compatible LLM adapter for local `vllm-gpt`
- OpenAI-style image adapter for future local or remote image services
- local disk asset storage behind a storage boundary

The current scope is documented in [instructions/backend_scope.md](instructions/backend_scope.md).

## Why This Shape

This repo should grow into the production backend without replacing the foundation.

That means:

- one tenant now, but `workspace_id` stays in the schema
- no fake agent graph
- no n8n core dependency
- no WebSocket dependency
- no provider lock-in

## Runtime Shape

- `api`: FastAPI app
- `worker`: DB-backed job processor
- `postgres`: application database

External services are referenced by adapter URLs:

- LLM: OpenAI-compatible `/v1/responses` endpoint
- media: OpenAI-style image generation endpoint

In local development, these can point to:

- sibling `vllm-gpt` for text generation
- a future local image middleware that mirrors `/v1/images/generations`

For Linux local development, `api` and `worker` run in host-network mode in Docker Compose so they can reach loopback-bound local services such as `vllm-gpt` on `127.0.0.1`.

## Quick Start

```bash
cp .env.example .env
docker compose up --build
```

The API will be available at `http://localhost:8080`.

## Key Endpoints

- `GET /health`
- `GET /v1/config`
- `GET /v1/workspace`
- `PUT /v1/workspace/brand-profile`
- `GET /v1/drafts`
- `POST /v1/drafts/generate`
- `POST /v1/media/generate`
- `GET /v1/jobs/{job_id}`

## Development With uv

```bash
uv sync
alembic upgrade head
uvicorn rebel_forge_backend.main:app --reload --host 0.0.0.0 --port 8080
python -m rebel_forge_backend.worker
```

## Implementation Notes

- LLM orchestration is deterministic and tool-driven. The model is asked to call a schema-constrained function for draft generation.
- Heavy work is persisted as jobs and processed by the worker.
- Assets are stored locally by default and exposed from `/assets`.
