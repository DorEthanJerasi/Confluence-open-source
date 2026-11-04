#!/usr/bin/env bash
# Installs and starts Stillwater without Docker, in the foreground, on
# 127.0.0.1:$PORT (default 3000). A local Postgres is started for it, with
# its data in .local-data/ (set DATABASE_URL to use your own instead).
# Stop with Ctrl+C. See INSTALL.md.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

export PORT="${PORT:-3000}"
export HOST="${HOST:-127.0.0.1}"
# Keep the npm cache inside the project, so it works where ~/.npm is not writable.
export npm_config_cache="${npm_config_cache:-$PWD/.npm-cache}"

if ! command -v node >/dev/null 2>&1; then
  echo "install.sh: Node.js 22 or newer is needed (see .nvmrc)" >&2
  exit 1
fi
major="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$major" -lt 22 ]; then
  echo "install.sh: Node.js 22 or newer is needed, found $(node -v)" >&2
  exit 1
fi

echo "install.sh: installing packages"
npm ci --no-audit --no-fund --prefer-offline

echo "install.sh: building"
npm run build

echo "install.sh: starting on http://${HOST}:${PORT}"
exec node scripts/local-start.mjs
