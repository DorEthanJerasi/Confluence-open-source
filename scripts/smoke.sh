#!/usr/bin/env bash
# Brings up the real docker compose stack (app + Postgres) and checks it
# actually works: health, including a round trip to the database through
# the migrated schema. Tears the stack down afterwards.
#
# Usage: scripts/smoke.sh
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

if [ -z "${PORT:-}" ] && [ -f .env ]; then
  PORT="$(grep -E '^PORT=' .env | tail -n1 | cut -d= -f2-)"
fi
PORT="${PORT:-3000}"
COMPOSE="docker compose"

cleanup() {
  echo "smoke: tearing down"
  $COMPOSE down -v --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "smoke: building and starting the stack"
$COMPOSE up -d --build

echo "smoke: waiting for app health"
tries=0
until curl -sf "http://localhost:${PORT}/health" >/dev/null; do
  tries=$((tries + 1))
  if [ "$tries" -ge 60 ]; then
    echo "smoke: FAILED — app never became healthy" >&2
    $COMPOSE logs --no-color app || true
    exit 1
  fi
  sleep 2
done

body="$(curl -sf "http://localhost:${PORT}/health")"
echo "smoke: /health responded: ${body}"

case "$body" in
  *'"status":"ok"'*) ;;
  *)
    echo "smoke: FAILED — unexpected /health body: ${body}" >&2
    exit 1
    ;;
esac

echo "smoke: PASSED"
echo "SMOKE OK"
