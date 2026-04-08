FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim

WORKDIR /app

COPY pyproject.toml README.md ./
RUN uv sync --no-dev --no-install-project

COPY alembic.ini ./
COPY alembic ./alembic
COPY instructions ./instructions
COPY src ./src

RUN uv sync --no-dev

ENV PATH="/app/.venv/bin:${PATH}"
CMD ["uvicorn", "rebel_forge_backend.main:app", "--host", "0.0.0.0", "--port", "8080"]

