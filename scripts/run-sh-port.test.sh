#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/scripts/run-sh-port.sh"

BASE_PORT="$(find_available_port 39202)"
node -e '
  const net = require("net");
  const server = net.createServer();
  server.listen(Number(process.argv[1]), "127.0.0.1", () => {
    console.log("ready");
  });
  process.on("SIGTERM", () => server.close(() => process.exit(0)));
' "$BASE_PORT" >/tmp/openlingo-port-test.log 2>&1 &
SERVER_PID=$!
trap 'kill "$SERVER_PID" >/dev/null 2>&1 || true' EXIT

for _ in $(seq 1 50); do
  if grep -q ready /tmp/openlingo-port-test.log; then
    break
  fi
  sleep 0.1
done

if ! grep -q ready /tmp/openlingo-port-test.log; then
  cat /tmp/openlingo-port-test.log >&2
  exit 1
fi

NEXT_PORT="$(find_available_port "$BASE_PORT")"
if [ "$NEXT_PORT" -eq "$BASE_PORT" ]; then
  echo "expected find_available_port to skip occupied port $BASE_PORT" >&2
  exit 1
fi

if [ "$NEXT_PORT" -ne "$((BASE_PORT + 1))" ]; then
  echo "expected $((BASE_PORT + 1)), got $NEXT_PORT" >&2
  exit 1
fi
