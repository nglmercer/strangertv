#!/usr/bin/env bash
# Free common local dev ports (API 8787, Vite 5173) and leftover cargo/vite trees.
set -euo pipefail

PORTS=(${FREE_PORTS:-8787 5173})

free_port() {
  local port=$1
  local pids
  pids=$(ss -tlnp 2>/dev/null | awk -v p=":$port" '$4 ~ p"$" {print}' || true)
  if command -v fuser >/dev/null 2>&1; then
    if fuser "${port}/tcp" >/dev/null 2>&1; then
      echo "Killing listeners on port ${port}..."
      fuser -k "${port}/tcp" 2>/dev/null || true
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
if pgrep -f 'cargo watch -x run' >/dev/null 2>&1; then
  echo "Stopping leftover: cargo watch"
  pkill -f 'cargo watch -x run' 2>/dev/null || true
fi
if pgrep -f 'stranger-server' >/dev/null 2>&1; then
  echo "Stopping leftover: stranger-server"
  pkill -f 'stranger-server' 2>/dev/null || true
fi
if pgrep -f 'concurrently -k .*vite.*cargo' >/dev/null 2>&1; then
  echo "Stopping leftover: concurrently dev"
  pkill -f 'concurrently -k .*vite.*cargo' 2>/dev/null || true
fi

echo "Done. Start again with: npm run dev"
