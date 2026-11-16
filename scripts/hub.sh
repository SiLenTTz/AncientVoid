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

# realpath -m (kanonisch, auch für fehlende Pfade) ist GNU-only — BSD/macOS
# hat kein -m; dort dieselbe Semantik über Node (läuft ohnehin für den Hub).
canon() {
  if realpath -m / >/dev/null 2>&1; then realpath -m "$1"; return; fi
  node -e 'const fs=require("node:fs"),p=require("node:path");let x=p.resolve(process.argv[1]);const rest=[];while(!fs.existsSync(x)&&x!==p.dirname(x)){rest.unshift(p.basename(x));x=p.dirname(x);}process.stdout.write(p.join(fs.realpathSync(x),...rest)+"\n")' "$1"
}

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
  # Eigene Prozessgruppe, damit stop() die Gruppe signalisieren kann: setsid
  # (util-linux) oder — ohne setsid, z. B. macOS — Job-Control (set -m).
  if command -v setsid >/dev/null 2>&1; then
    ANCIENTVOID_CONFIG="${ANCIENTVOID_CONFIG:-$(pwd)/hub.config.json}" \
      setsid node apps/hub/src/main.ts >>"$LOG" 2>&1 < /dev/null &
  else
    set -m
    ANCIENTVOID_CONFIG="${ANCIENTVOID_CONFIG:-$(pwd)/hub.config.json}" \
      node apps/hub/src/main.ts >>"$LOG" 2>&1 < /dev/null &
    set +m
  fi
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
    if systemctl --user cat ancientvoid-hub.service >/dev/null 2>&1 && [ "${HUB_LOCAL:-0}" != "1" ]; then
      unit_root="$(systemctl --user show ancientvoid-hub.service -p WorkingDirectory --value)"
      unit_files="$(systemctl --user show ancientvoid-hub.service -p EnvironmentFiles --value)"
      unit_config="$(systemctl --user show ancientvoid-hub.service -p Environment --value | node -e '
        let input = "";
        process.stdin.on("data", chunk => { input += chunk; });
        process.stdin.on("end", () => {
          const match = input.match(/(?:^|\s)(?:"ANCIENTVOID_CONFIG=([^"\\]*)"|ANCIENTVOID_CONFIG=([^\s"\\]+))/);
          if (!match && input.includes("ANCIENTVOID_CONFIG=")) process.exit(1);
          console.log(match?.[1] ?? match?.[2] ?? "hub.config.json");
        });')"
      if [[ "$unit_config" != /* ]]; then unit_config="$unit_root/$unit_config"; fi
      requested_config="$(canon "${ANCIENTVOID_CONFIG:-$PWD/hub.config.json}")"
      if [ -z "$unit_root" ] || [ -n "$unit_files" ] || [ "$(canon "$unit_root")" != "$(pwd -P)" ] || [ "$requested_config" != "$(canon "$unit_config")" ]; then
        echo "Konflikt: ancientvoid-hub.service gehört einem anderen Checkout" >&2
        [ -n "$unit_root" ] && echo "  Unit: WorkingDirectory=$unit_root ANCIENTVOID_CONFIG=$unit_config" >&2 || echo "  Unit nennt keinen WorkingDirectory (nicht zuordenbar)" >&2
        echo "  Nichts verändert. Für einen Hub DIESES Checkouts: HUB_LOCAL=1 $0 $1" >&2
        exit 1
      fi
      echo "-> systemd: systemctl --user ${1} ancientvoid-hub.service"
      systemctl --user "${1}" ancientvoid-hub.service
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
