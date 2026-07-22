#!/usr/bin/env bash

set -Eeuo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$PROJECT_DIR/backend"
FRONTEND_DIR="$PROJECT_DIR/frontend"
CHILD_PIDS=()

cleanup() {
  trap - EXIT INT TERM
  if ((${#CHILD_PIDS[@]})); then
    kill "${CHILD_PIDS[@]}" 2>/dev/null || true
    wait "${CHILD_PIDS[@]}" 2>/dev/null || true
  fi
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

trap cleanup EXIT INT TERM

require_command docker
require_command npm
require_command uv

if [[ ! -f "$BACKEND_DIR/.env" ]]; then
  echo "Missing backend/.env. Create it with:" >&2
  echo "  cp backend/.env.example backend/.env" >&2
  exit 1
fi

echo "Synchronizing dependencies..."
(
  cd "$BACKEND_DIR"
  uv sync --locked
)
(
  cd "$FRONTEND_DIR"
  npm ci
)

echo "Starting PostgreSQL and applying migrations..."
docker compose --project-directory "$PROJECT_DIR" up -d --wait postgres
(
  cd "$BACKEND_DIR"
  uv run alembic upgrade head
)

echo "Starting API, worker, and frontend..."
(
  cd "$BACKEND_DIR"
  exec uv run uvicorn rebel_forge_backend.main:app --host 127.0.0.1 --port 8080 --reload
) &
CHILD_PIDS+=("$!")

(
  cd "$BACKEND_DIR"
  exec uv run python -m rebel_forge_backend.worker
) &
CHILD_PIDS+=("$!")

(
  cd "$FRONTEND_DIR"
  exec npm run dev
) &
CHILD_PIDS+=("$!")

echo "Frontend: http://localhost:3000"
echo "API:      http://localhost:8080"
echo "Docs:     http://localhost:8080/docs"
echo "Press Ctrl+C to stop the application processes. PostgreSQL remains running."

wait -n "${CHILD_PIDS[@]}"
