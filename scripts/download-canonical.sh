#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DUMPS_DIR="${DUMPS_DIR:-$ROOT_DIR/dumps}"
BASE_URL="${CANONICAL_DUMP_BASE_URL:-https://ftp.musicbrainz.org/pub/musicbrainz/canonical_data}"

mkdir -p "$DUMPS_DIR"

latest_dump_name() {
  curl -fsSL "$BASE_URL/" \
    | grep -oE 'musicbrainz-canonical-dump-[0-9]{8}-[0-9]{6}' \
    | sort -r \
    | head -n 1
}

DUMP_NAME="${1:-$(latest_dump_name)}"
if [[ -z "$DUMP_NAME" ]]; then
  echo "Could not determine latest canonical dump name" >&2
  exit 1
fi

ARCHIVE_NAME="${DUMP_NAME}.tar.zst"
ARCHIVE_PATH="$DUMPS_DIR/$ARCHIVE_NAME"
DUMP_URL="$BASE_URL/$DUMP_NAME/$ARCHIVE_NAME"

if [[ -f "$ARCHIVE_PATH" ]]; then
  echo "Archive already exists: $ARCHIVE_PATH"
  exit 0
fi

echo "Downloading $DUMP_URL"
curl -fL --retry 5 --retry-delay 10 -o "$ARCHIVE_PATH.part" "$DUMP_URL"
mv "$ARCHIVE_PATH.part" "$ARCHIVE_PATH"
echo "Saved $ARCHIVE_PATH"
