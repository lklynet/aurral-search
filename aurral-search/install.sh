#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

require_cmd node
require_cmd npm
require_cmd docker
require_cmd curl
require_cmd zstd
require_cmd tar

NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
if [[ "$NODE_MAJOR" -lt 22 ]]; then
  echo "Node 22+ is required" >&2
  exit 1
fi

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "Created .env from .env.example — set MEILI_MASTER_KEY before continuing"
fi

set -a
# shellcheck disable=SC1091
source .env
set +a

if [[ -z "${MEILI_MASTER_KEY:-}" || "${MEILI_MASTER_KEY}" == "change-me-to-a-long-random-string" ]]; then
  echo "Set MEILI_MASTER_KEY in .env before running install" >&2
  exit 1
fi

npm install
docker compose up -d meilisearch

echo "Waiting for Meilisearch..."
for _ in $(seq 1 60); do
  if curl -fsS -H "Authorization: Bearer $MEILI_MASTER_KEY" "${MEILI_URL:-http://127.0.0.1:7700}/health" >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

if [[ "${SKIP_DOWNLOAD:-0}" != "1" ]]; then
  ./scripts/download-canonical.sh
fi

if [[ "${SKIP_INDEX_BUILD:-0}" != "1" ]]; then
  npm run build-index
  npm run export-jsonl
  npm run bulk-import
fi

if [[ "${SKIP_API_START:-0}" != "1" ]]; then
  docker compose up -d api
fi

echo "Install complete."
echo "API: http://127.0.0.1:${API_PORT:-3100}/search?q=radiohead"
