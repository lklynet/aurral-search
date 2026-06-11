#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

set -a
# shellcheck disable=SC1091
source .env
set +a

./scripts/download-canonical.sh
rm -rf "${DATA_DIR:-./data}/staging" "${DATA_DIR:-./data}/jsonl"
npm run build-index
npm run export-jsonl
npm run bulk-import

if docker compose ps api >/dev/null 2>&1; then
  docker compose restart api
else
  systemctl restart aurral-search-api 2>/dev/null || true
fi

echo "Update complete."
