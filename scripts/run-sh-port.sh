#!/usr/bin/env bash

is_port_in_use() {
  local port="$1"
  ss -ltn "sport = :$port" 2>/dev/null | awk 'NR > 1 { found = 1 } END { exit found ? 0 : 1 }'
}

find_available_port() {
  local port="${1:-3002}"
  local attempts="${2:-50}"

  for _ in $(seq 1 "$attempts"); do
    if ! is_port_in_use "$port"; then
      printf "%s\n" "$port"
      return 0
    fi
    port=$((port + 1))
  done

  return 1
}
