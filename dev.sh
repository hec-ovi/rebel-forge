#!/bin/bash
# Start all Rebel Forge services in one terminal with labeled output
# Usage: ./dev.sh

trap 'kill 0; exit' EXIT INT TERM

DIR="$(cd "$(dirname "$0")" && pwd)"

# Kill stale processes
pkill -f "next dev" 2>/dev/null
pkill -f "next-server" 2>/dev/null
pkill -f "uvicorn rebel_forge" 2>/dev/null
pkill -f "rebel_forge_backend.worker" 2>/dev/null
lsof -ti :8080 | xargs kill -9 2>/dev/null
lsof -ti :3000 | xargs kill -9 2>/dev/null
rm -f "$DIR/frontend/.next/dev/lock" 2>/dev/null
sleep 1

echo "Starting Rebel Forge..."
echo ""

# Ensure Postgres is running
if ! docker ps --format '{{.Names}}' | grep -q rebel-forge-postgres; then
  echo "[DB] Starting PostgreSQL..."
  docker start rebel-forge-postgres 2>/dev/null || \
    docker run -d --name rebel-forge-postgres \
      -e POSTGRES_DB=rebel_forge \
      -e POSTGRES_USER=postgres \
      -e POSTGRES_PASSWORD=postgres \
      -e PGDATA=/var/lib/postgresql/data/pgdata \
      -v "$DIR/backend/data/pgdata:/var/lib/postgresql/data/pgdata" \
      -p 5432:5432 \
      pgvector/pgvector:pg17
  sleep 3
fi
echo "[DB] PostgreSQL running on :5432"

# Backend API (auto-reloads on file changes)
cd "$DIR/backend" && .venv/bin/uvicorn rebel_forge_backend.main:app \
  --host 0.0.0.0 --port 8080 --reload 2>&1 | sed 's/^/[API]    /' &

# Worker (auto-restart on crash)
cd "$DIR/backend" && while true; do
  .venv/bin/python -m rebel_forge_backend.worker 2>&1 | sed 's/^/[WORKER] /'
  echo "[WORKER] Restarting in 2s..."
  sleep 2
done &

# Frontend (Next.js dev with HMR)
cd "$DIR/frontend" && npm run dev 2>&1 | sed 's/^/[NEXT]   /' &

echo ""
echo "  Frontend:  http://localhost:3000"
echo "  API:       http://localhost:8080"
echo "  API docs:  http://localhost:8080/docs"
echo ""
echo "Press Ctrl+C to stop all."
echo ""

wait
