#!/usr/bin/env bash
# AncientVoid — hub daemon lifecycle for local dev (P0).
#   scripts/hub.sh start|stop|status|logs
set -euo pipefail
cd "$(dirname "$0")/.."
# BUG-0132: PID und Log je Checkout — zwei lokale Hubs teilen sich keine Datei.
RUN_ID="$(printf '%s' "$PWD" | cksum | cut -d' ' -f1)"
PIDFILE="/tmp/ancientvoid-hub-$RUN_ID.pid"
LOG="/tmp/ancientvoid-hub-$RUN_ID.log"
LEGACY_PIDFILE="/tmp/ancientvoid-hub.pid"
if [ ! -f "$PIDFILE" ] && [ -f "$LEGACY_PIDFILE" ]; then
  legacy_pid="$(cat "$LEGACY_PIDFILE")"
  # Ein vor dem Umbau gestarteter Daemon dieses Checkouts bleibt steuerbar.
  if kill -0 "$legacy_pid" 2>/dev/null && tr '\0' '\n' < "/proc/$legacy_pid/environ" 2>/dev/null | grep -qxF "ANCIENTVOID_CONFIG=$PWD/hub.config.json"; then
    mv "$LEGACY_PIDFILE" "$PIDFILE"
  fi
fi

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
    local port
    port="$(node -e 'try{console.log(require(process.env.ANCIENTVOID_CONFIG || "./hub.config.json").server?.port ?? 7373)}catch{console.log(7373)}' 2>/dev/null || echo 7373)"
    curl -s "http://127.0.0.1:$port/api/health" || true
    echo
  else
    echo "not running"
  fi
}

case "${1:-}" in
  start|stop|status)
    # A installed user unit wins over the dev daemon — never two hubs on
    # one port (the unit also survives reboots, this script does not).
    # HUB_LOCAL=1 (EPIC-P53 setup wizard): force the dev daemon even when
    # a unit exists — for setups on a second port (setup.sh --port).
    # BUG-0156: Eine Unit wird nur bei nachgewiesener Checkout-Identität
    # angesprochen (ANCIENTVOID_CONFIG der Unit == hub.config.json DIESES
    # Checkouts) — sonst würde ein fremder Klon die Produktiv-Unit
    # stoppen/starten (Vorfall 13.11.2026, 14 min Downtime).
    if systemctl --user cat ancientvoid-hub.service >/dev/null 2>&1 && [ "${HUB_LOCAL:-0}" != "1" ]; then
      unit_config="$(systemctl --user show -p Environment --value ancientvoid-hub.service 2>/dev/null | tr ' ' '\n' | sed -n 's/^ANCIENTVOID_CONFIG=//p')"
      if [ -n "$unit_config" ] && [ "$unit_config" = "$PWD/hub.config.json" ]; then
        echo "-> systemd: systemctl --user ${1} ancientvoid-hub.service"
        systemctl --user "${1}" ancientvoid-hub.service || true
        exit 0
      fi
      echo "Konflikt: ancientvoid-hub.service gehört einem anderen Checkout" >&2
      [ -n "$unit_config" ] && echo "  Unit: $unit_config" >&2 || echo "  Unit nennt keinen ANCIENTVOID_CONFIG (nicht diesem Checkout zuordenbar)" >&2
      echo "  Nichts verändert. Für einen Hub DIESES Checkouts: HUB_LOCAL=1 $0 $1" >&2
      exit 6
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
