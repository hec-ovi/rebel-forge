# Rebel Forge Backend

FastAPI and PostgreSQL backend for one creator or brand workspace. The API, worker, provider adapters, prompts, migrations, and local asset storage live in this directory. See the [architecture reference](../docs/architecture.md) for the full system map.

## Runtime

- Python 3.12 or newer
- FastAPI API on port 8080
- PostgreSQL 17 with pgvector
- Database-backed worker for draft and media jobs
- OpenAI Responses-compatible text providers or the local Codex CLI
- ComfyUI, fal.ai, or an OpenAI-compatible image endpoint
- Local asset storage with optional Cloudflare R2 uploads

The Docker services use host networking on Linux so the API and worker can reach services bound to `127.0.0.1`, including vLLM and ComfyUI.

## Start with Docker

From the repository root:

```bash
cp backend/.env.example backend/.env
docker compose up --build
```

The API is available at `http://localhost:8080`; OpenAPI documentation is at `http://localhost:8080/docs`.

The owner and viewer tokens are never exposed by an HTTP endpoint. Print the initial local tokens from the API container:

```bash
docker compose exec api rebel-forge-tokens
```

Keep the owner token private. A viewer token can read viewer-authorized resources but receives HTTP 403 for owner-only actions.

## Develop with uv

Start PostgreSQL first, then run:

```bash
uv sync
uv run alembic upgrade head
uv run uvicorn rebel_forge_backend.main:app --reload --host 127.0.0.1 --port 8080
```

Run the worker in another terminal:

```bash
uv run python -m rebel_forge_backend.worker
```

Print local bootstrap tokens with:

```bash
uv run rebel-forge-tokens
```

## Verify

```bash
uv run ruff check .
uv run pytest -q
uv run pytest --cov=rebel_forge_backend --cov-report=term-missing
uv run alembic history
```

The test suite exercises HTTP authorization and workspace behavior, database side effects, job transitions, workspace-scoped content queries, multi-round LLM tool calls, provider payloads, credential persistence failures, asset storage, publishers, migration loading, and container assumptions. External HTTP and process boundaries are replaced in tests; application services and route entry points remain real.

## Configuration

Copy `.env.example` and set only the providers you use. Empty values are treated as unconfigured. Important paths are resolved from the backend directory:

- `DATA_BASE_PATH`: tokens, training recommendations, and imported raw style examples
- `STORAGE_BASE_PATH`: generated local assets
- `PROMPTS_BASE_PATH`: agent prompts and the ComfyUI workflow

The connections API can update credentials only when a writable backend `.env` file exists. Its response sets `recreate_required` after an update because Compose injects `env_file` values when containers are created. From the repository root, apply changes with:

```bash
docker compose up -d --force-recreate api worker
```

## Main endpoints

- `GET /health`
- `POST /v1/auth/login`
- `GET /v1/readiness`
- `GET /v1/workspace`
- `PUT /v1/workspace/brand-profile`
- `GET /v1/drafts`
- `POST /v1/drafts/generate`
- `POST /v1/chat`
- `POST /v1/media/generate`
- `GET /v1/jobs/{job_id}`

Protected endpoints use Bearer authentication. The OpenAPI schema declares the `BearerAuth` security scheme, so tokens can be entered through the documentation UI.
