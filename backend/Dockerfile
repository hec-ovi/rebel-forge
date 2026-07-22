FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim

WORKDIR /app

COPY pyproject.toml uv.lock README.md ./
RUN uv sync --frozen --no-dev --no-install-project

COPY alembic.ini ./
COPY alembic ./alembic
COPY prompts ./prompts
COPY src ./src

RUN uv sync --frozen --no-dev

RUN groupadd --gid 1000 app && \
    useradd --uid 1000 --gid app --create-home app && \
    mkdir -p /app/data && \
    chown -R app:app /app

ENV PATH="/app/.venv/bin:${PATH}"
USER app
CMD ["uvicorn", "rebel_forge_backend.main:app", "--host", "0.0.0.0", "--port", "8080"]
