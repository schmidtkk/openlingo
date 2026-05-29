#!/usr/bin/env bash
set -e

BUN=/home/weidongguo/workspace/claude-mem/cmem/bun/bin/bun
PGBIN=/home/weidongguo/miniconda3/envs/pg_lingo/bin
PGDATA=/data/weidong/OpenLingo/.pgdata
PGPORT=5437
PGUSER=lingo
export PGPASSWORD=lingo_local_dev
PORT="${PORT:-3003}"
TTS_SCRIPT=/data/weidong/TTS/tts_exploration/start_tts_server.sh
TTS_PID=

DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

source "$DIR/scripts/run-sh-port.sh"

read_env_value() {
  local key="$1"
  awk -F= -v key="$key" '$1 == key { sub(/^[^=]*=/, ""); value=$0 } END { print value }' .env.local
}

cleanup() {
  if [ -n "$TTS_PID" ] && kill -0 "$TTS_PID" >/dev/null 2>&1; then
    echo "Stopping TTS server (pid $TTS_PID)..."
    kill -- "-$TTS_PID" >/dev/null 2>&1 || kill "$TTS_PID" >/dev/null 2>&1 || true
    wait "$TTS_PID" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT INT TERM

# Make bun and ccswitch available on PATH for sub-scripts
export PATH="$(dirname $BUN):$HOME/.cargo/bin:$PATH"

# HTTP proxy (equivalent to the `gtz` alias) — required to reach
# upstream LLM/TTS APIs from this machine. Exclude loopback/local
# services from the proxy so Postgres and the Next.js server itself
# are not routed through it.
export http_proxy="${http_proxy:-http://127.0.0.1:8888}"
export https_proxy="${https_proxy:-http://127.0.0.1:8888}"
export HTTP_PROXY="$http_proxy"
export HTTPS_PROXY="$https_proxy"
export no_proxy="${no_proxy:-127.0.0.1,localhost,::1}"
export NO_PROXY="$no_proxy"
echo "Proxy: $http_proxy (no_proxy=$no_proxy)"

# Start local TTS as a child process of this script. Its logs go to a file so it
# does not take over the terminal used for OpenLingo.
if [ "${AUTO_START_TTS:-1}" != "0" ]; then
  LOCAL_TTS_URL_FROM_ENV="$(read_env_value LOCAL_TTS_URL)"
  LOCAL_TTS_MODEL_FROM_ENV="$(read_env_value LOCAL_TTS_MODEL)"
  LOCAL_TTS_VOICE_FROM_ENV="$(read_env_value LOCAL_TTS_VOICE)"

  if [ -n "$LOCAL_TTS_URL_FROM_ENV" ]; then
    TTS_PORT="$(printf "%s" "$LOCAL_TTS_URL_FROM_ENV" | sed -nE 's#^https?://[^/:]+:([0-9]+).*#\1#p')"
    TTS_PORT="${TTS_PORT:-8880}"
    TTS_LOG="$DIR/.logs/tts-server.log"
    mkdir -p "$DIR/.logs"

    if curl -fsS "$LOCAL_TTS_URL_FROM_ENV/health" >/dev/null 2>&1; then
      echo "TTS server already running at $LOCAL_TTS_URL_FROM_ENV"
    else
      echo "Starting TTS server at $LOCAL_TTS_URL_FROM_ENV (log: $TTS_LOG)"
      setsid "$TTS_SCRIPT" \
        "${LOCAL_TTS_MODEL_FROM_ENV:-voxtral}" \
        "${LOCAL_TTS_VOICE_FROM_ENV:-fr_male}" \
        "$TTS_PORT" >"$TTS_LOG" 2>&1 &
      TTS_PID=$!

      for _ in $(seq 1 60); do
        if curl -fsS "$LOCAL_TTS_URL_FROM_ENV/health" >/dev/null 2>&1; then
          echo "TTS server ready (pid $TTS_PID)"
          break
        fi
        if ! kill -0 "$TTS_PID" >/dev/null 2>&1; then
          echo "TTS server exited early. Last log lines:"
          tail -n 40 "$TTS_LOG" || true
          exit 1
        fi
        sleep 1
      done

      if ! curl -fsS "$LOCAL_TTS_URL_FROM_ENV/health" >/dev/null 2>&1; then
        echo "TTS server did not become ready in time. Last log lines:"
        tail -n 40 "$TTS_LOG" || true
        exit 1
      fi
    fi
  else
    echo "LOCAL_TTS_URL is empty; skipping local TTS startup."
  fi
fi

# Initialize PostgreSQL data dir if needed
if [ ! -d "$PGDATA" ]; then
  echo "Initializing PostgreSQL..."
  echo "$PGPASSWORD" > /tmp/_pg_pwfile
  $PGBIN/initdb -D "$PGDATA" --username=$PGUSER --pwfile=/tmp/_pg_pwfile --auth=md5
  rm -f /tmp/_pg_pwfile
fi

# Start PostgreSQL if not running
if ! $PGBIN/pg_ctl -D "$PGDATA" status > /dev/null 2>&1; then
  echo "Starting PostgreSQL on port $PGPORT..."
  $PGBIN/pg_ctl -D "$PGDATA" -o "-p $PGPORT" -l "$PGDATA/postgres.log" start
  sleep 2
  # Create DB if missing
  $PGBIN/psql -U $PGUSER -p $PGPORT -d postgres -tc \
    "SELECT 1 FROM pg_database WHERE datname='lingo'" | grep -q 1 || \
    $PGBIN/createdb -U $PGUSER -p $PGPORT lingo
else
  echo "PostgreSQL already running."
fi

# Run migrations
echo "Running migrations..."
$BUN run db:migrate

# Start dev server
REQUESTED_PORT="$PORT"
PORT="$(find_available_port "$REQUESTED_PORT")"
if [ "$PORT" != "$REQUESTED_PORT" ]; then
  echo "Port $REQUESTED_PORT is in use; using http://localhost:$PORT instead."
fi
echo "Starting OpenLingo on http://localhost:$PORT"
PORT=$PORT $BUN run dev
