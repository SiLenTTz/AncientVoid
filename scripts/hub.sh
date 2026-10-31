#!/usr/bin/env bash
# AncientVoid — hub daemon lifecycle for local dev (P0).
#   scripts/hub.sh start|stop|status|logs
set -euo pipefail
cd "$(dirname "$0")/.."
PIDFILE="/tmp/ancientvoid-hub.pid"
LOG="/tmp/ancientvoid-hub.log"

start() {
  if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
    echo "hub already running (pid $(cat "$PIDFILE"))"
    exit 0
  fi
  umask 077
  touch "$LOG"
  chmod 600 "$LOG"
  # BUG-0034: absolute, so `hubctl workers prune` can match this hub's root
  # against /proc/<pid>/environ (ANCIENTVOID_CONFIG) and never treat it as orphaned.
  ANCIENTVOID_CONFIG="${ANCIENTVOID_CONFIG:-$(pwd)/hub.config.json}" \
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
  start|stop|status)
    # A installed user unit wins over the dev daemon — never two hubs on
    # one port (the unit also survives reboots, this script does not).
    if systemctl --user cat ancientvoid-hub.service >/dev/null 2>&1; then
      echo "-> systemd: systemctl --user ${1} ancientvoid-hub.service"
      systemctl --user "${1}" ancientvoid-hub.service || true
      exit 0
    fi
    ;;
esac

case "${1:-}" in
  start) start ;;
  stop) stop ;;
  status) status ;;
  logs)
    if systemctl --user cat ancientvoid-hub.service >/dev/null 2>&1; then
      echo "-> systemd: journalctl --user -u ancientvoid-hub.service -f"
      exec journalctl --user -u ancientvoid-hub.service -f
    fi
    tail -f "$LOG"
    ;;
  *) echo "usage: $0 start|stop|status|logs"; exit 1 ;;
esac
