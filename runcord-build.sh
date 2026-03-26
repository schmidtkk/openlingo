#!/usr/bin/env bash
set -uo pipefail

if ! npx -y expect-cli@latest init; then
  echo "Warning: failed to install or initialize expect-cli; continuing anyway." >&2
fi

exit 0
