#!/usr/bin/env bash
# Free common local dev ports (API 8787, Vite 5173) and leftover cargo/vite trees.
set -euo pipefail

PORTS=(${FREE_PORTS:-8787 5173})

# Sweep policy for global leftover processes (cargo watch, stranger-server,
# concurrently dev parents). A killed server's `cargo watch` parent would
# otherwise resurrect it on the next file change, so:
#   unset/auto (default): sweep only when this run actually reclaimed a port
#   FREE_PORTS_SWEEP=1  : always sweep (recovery via `npm run dev:fresh`)
#   FREE_PORTS_SWEEP=0  : never sweep (tests/automation running next to dev)
RECLAIMED=0

free_port() {
  local port=$1
  local pids
  pids=$(ss -tlnp 2>/dev/null | awk -v p=":$port" '$4 ~ p"$" {print}' || true)
  if command -v fuser >/dev/null 2>&1; then
    if fuser "${port}/tcp" >/dev/null 2>&1; then
      echo "Killing listeners on port ${port}..."
      fuser -k "${port}/tcp" 2>/dev/null || true
      RECLAIMED=1
      sleep 0.3
    else
      echo "Port ${port}: free"
    fi
    return
  fi
  if command -v lsof >/dev/null 2>&1; then
    local ids
    ids=$(lsof -t -iTCP:"${port}" -sTCP:LISTEN 2>/dev/null || true)
    if [[ -n "${ids}" ]]; then
      echo "Killing PIDs on ${port}: ${ids}"
      # shellcheck disable=SC2086
      kill ${ids} 2>/dev/null || true
      RECLAIMED=1
      sleep 0.3
    else
      echo "Port ${port}: free"
    fi
    return
  fi
  echo "Install fuser (psmisc) or lsof to free port ${port} automatically."
  echo "Manual: ss -tlnp | grep ${port}"
}

for p in "${PORTS[@]}"; do
  free_port "$p"
done

# Orphaned watchers sometimes hold no listen socket after EADDRINUSE.
SWEEP="${FREE_PORTS_SWEEP:-auto}"
if [[ "${SWEEP}" == "1" || ( "${SWEEP}" == "auto" && "${RECLAIMED}" == "1" ) ]]; then
  if pgrep -f 'cargo watch -x run' >/dev/null 2>&1; then
    echo "Stopping leftover: cargo watch"
    pkill -f 'cargo watch -x run' 2>/dev/null || true
  fi
  if pgrep -f 'stranger-server' >/dev/null 2>&1; then
    echo "Stopping leftover: stranger-server"
    pkill -f 'stranger-server' 2>/dev/null || true
  fi
  # Matches both child orders (vite-first and api-first dev commands).
  if pgrep -f 'concurrently -k .*(cargo.*vite|vite.*cargo)' >/dev/null 2>&1; then
    echo "Stopping leftover: concurrently dev"
    pkill -f 'concurrently -k .*(cargo.*vite|vite.*cargo)' 2>/dev/null || true
  fi
fi

echo "Done. Dev ports are free."
