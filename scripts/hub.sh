#!/usr/bin/env bash
# UACC — hub daemon lifecycle for local dev (P0).
#   scripts/hub.sh start|stop|status|logs
set -euo pipefail
cd "$(dirname "$0")/.."
PIDFILE="/tmp/uacc-hub.pid"
LOG="/tmp/uacc-hub.log"

start() {
  if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
    echo "hub already running (pid $(cat "$PIDFILE"))"
    exit 0
  fi
  umask 077
  touch "$LOG"
  chmod 600 "$LOG"
  # BUG-0034: absolute, so `hubctl workers prune` can match this hub's root
  # against /proc/<pid>/environ (UACC_CONFIG) and never treat it as orphaned.
  UACC_CONFIG="${UACC_CONFIG:-$(pwd)/hub.config.json}" \
    setsid node apps/hub/src/main.ts >>"$LOG" 2>&1 < /dev/null &
  local pid=$!
  echo "$pid" > "$PIDFILE"
  sleep 1.5
  if kill -0 "$pid" 2>/dev/null; then
    echo "hub started (pid $pid, log: $LOG)"
  else
    echo "hub failed to start — see $LOG"
    tail -5 "$LOG" || true
    rm -f "$PIDFILE"
    exit 1
  fi
}

stop() {
  if [ -f "$PIDFILE" ]; then
    local pid pgid
    pid=$(cat "$PIDFILE")
    if kill -0 "$pid" 2>/dev/null; then
      pgid=$(ps -o pgid= -p "$pid" 2>/dev/null | tr -d ' ')
      # setsid may leave a shell as the recorded process and Node as its
      # child. Signal the isolated process group so the hub handles SIGTERM.
      if [ "$pgid" = "$pid" ]; then
        kill -TERM -- "-$pid" 2>/dev/null || true
      else
        kill -TERM "$pid" 2>/dev/null || true
      fi
      for _ in $(seq 1 100); do
        if ! kill -0 -- "-$pid" 2>/dev/null; then break; fi
        sleep 0.1
      done
      if kill -0 -- "-$pid" 2>/dev/null; then
        echo "hub stop timed out (process group $pid still exists)" >&2
        return 1
      fi
    fi
    rm -f "$PIDFILE"
    echo "hub stopped"
  else
    echo "not running"
  fi
}

status() {
  if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
    echo "running (pid $(cat "$PIDFILE"))"
    curl -s http://127.0.0.1:7373/api/health || true
    echo
  else
    echo "not running"
  fi
}

case "${1:-}" in
  start) start ;;
  stop) stop ;;
  status) status ;;
  logs) tail -f "$LOG" ;;
  *) echo "usage: $0 start|stop|status|logs"; exit 1 ;;
esac
