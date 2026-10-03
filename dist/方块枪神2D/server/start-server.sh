#!/usr/bin/env sh
# Block Gunner 2D zero-dependency server launcher (Linux / macOS)
set -e

cd "$(dirname "$0")"

NODE="${NODE:-node}"
if ! command -v "$NODE" >/dev/null 2>&1; then
  echo "[ERROR] node not found. Install Node.js 16+ or set NODE=/path/to/node" >&2
  exit 1
fi

echo "Starting Block Gunner 2D zero-dependency server..."
exec "$NODE" server.js "$@"