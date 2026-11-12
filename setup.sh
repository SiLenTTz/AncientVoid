#!/usr/bin/env bash
# AncientVoid — One-Command-Setup (EPIC-P53 T53.3).
#
# Wizard vom frischen Klon zum laufenden Hub. Nutzervorgabe: der erste
# Schritt bindet den ersten Provider an — erst wenn der steht, folgen PWA,
# Token und Start. Idempotent: ein zweiter Lauf überschreibt keine Config,
# stellt kein zweites Token aus und startet keinen zweiten Hub.
#
# Flags:  --yes                keine Rückfragen, Defaults (Adapter: dummy)
#         --adapter=<id>       dummy|claude|codex|opencode|copilot|pi|hermes|
#                             dsh|openai (openai fragt baseUrl/model, bzw.
#                             --base-url/--model)
#         --device-label=<n>   Name fürs Device-Token (Default: hostname)
#         --port=<n>           Port des Hubs (Default aus Config-Beispiel: 7373;
#                             nützlich, wenn dort schon ein Hub läuft)
#         --voidwarden         zusätzlich agent:- und display:-Token für
#                             VoidWarden ausstellen (Kaskade, s. README)
#         --no-pwa             PWA nicht bauen
#         --no-start           Hub nicht starten
# Exit:   0 ok · 2 Voraussetzung fehlt oder ungültige Eingabe (Option,
#         Adapter, baseUrl/Modell) · 3 Config/Daten kaputt ·
#         4 Token/Hub-Start fehlgeschlagen · 5 npm install fehlgeschlagen ·
#         6 Port belegt von einem Hub/Dienst, der nicht zu diesem Checkout gehört
set -euo pipefail
cd "$(dirname "$0")"

ADAPTER=""; LABEL="$(hostname)"; YES=0; PWA=1; START=1; VOIDWARDEN=0; BASE_URL=""; MODEL=""; PORT=""
for arg in "$@"; do
  case "$arg" in
    --yes) YES=1 ;;
    --adapter=*) ADAPTER="${arg#*=}" ;;
    --device-label=*) LABEL="${arg#*=}" ;;
    --port=*) PORT="${arg#*=}" ;;
    --voidwarden) VOIDWARDEN=1 ;;
    --no-pwa) PWA=0 ;;
    --no-start) START=0 ;;
    --base-url=*) BASE_URL="${arg#*=}" ;;
    --model=*) MODEL="${arg#*=}" ;;
    *) echo "unbekannte Option: $arg (siehe Skript-Kopf)" >&2; exit 2 ;;
  esac
done

say()  { printf '\n== %s\n' "$*"; }
ask()  { # ask <Var> <Prompt> <Default> — Antwort in Var (Std: Default; kein TTY wie --yes)
  local __var="$1" __q="$2" __def="$3" __ans=""
  if [ "$YES" = 1 ] || [ ! -t 0 ]; then eval "$__var=\$__def"; return; fi
  read -r -p "$__q [$__def]: " __ans || true
  eval "$__var=\${__ans:-\$__def}"
}

# ---------------------------------------------------------------- 0 · Prüfungen
say "0/5 Voraussetzungen"
fail_req() { echo "FEHLT: $*" >&2; echo "Beheben und erneut ausführen — der Wizard ist idempotent." >&2; exit 2; }
command -v node >/dev/null || fail_req "Node.js (https://nodejs.org) 22.18+, 24 oder 26+"
NODE_VER="$(node --version 2>/dev/null || echo v0.0.0)"
NODE_MAJ="${NODE_VER#v}"; NODE_MAJ="${NODE_MAJ%%.*}"
NODE_MIN="${NODE_VER#v}"; NODE_MIN="${NODE_MIN#*.}"; NODE_MIN="${NODE_MIN%%.*}"
# Geprüfte Matrix (BUG-0133, frischer Klon: npm ci, Wizard, hubctl, Hub, PWA-Build):
# 22.18 ist die erste 22er, die .ts ohne Flag ausführt; 23/25 decken vitest/eslint nicht ab.
if ! { { [ "$NODE_MAJ" = 22 ] && [ "$NODE_MIN" -ge 18 ]; } || [ "$NODE_MAJ" = 24 ] || [ "$NODE_MAJ" -ge 26 ]; }; then
  fail_req "Node 22.18+, 24 oder 26+ (gefunden: $NODE_VER) — strip-types ohne Flag und die Toolchain brauchen es"
fi
command -v npm >/dev/null || fail_req "npm"
command -v git >/dev/null || fail_req "git"
# tmux fehlt nur als Warnung: Worker-Runner hat den process-Fallback.
command -v tmux >/dev/null || echo "Hinweis: tmux fehlt — Worker laufen im process-Runner (konfigurierbar)."
echo "ok: node $NODE_VER, npm $(npm --version)"

# ------------------------------------------------------- 1 · erster Provider
# Nutzervorgabe: Provider zuerst — ein Hub ohne Provider „läuft", kann aber
# nichts. Erkannte CLIs werden vorgeschlagen; dummy funktioniert immer.
say "1/5 Ersten Provider anbinden"
detect() { command -v "$1" >/dev/null 2>&1 && echo "$1" || true; }
FOUND=""
for cli in claude codex opencode copilot pi hermes dsh; do
  d="$(detect "$cli")"; [ -n "$d" ] && FOUND="$FOUND $d"
done
[ -n "$FOUND" ] && echo "erkannt:$FOUND"

adapter_json() { # adapter_json <id> — ein Adapter-JSON-Objekt auf stdout
  case "$1" in
    dummy)    echo '{"id":"dummy","module":"@ancientvoid/adapter-dummy","config":{"eventsPerSecond":5}}' ;;
    claude)   echo '{"id":"claude","module":"@ancientvoid/adapter-claude"}' ;;
    codex)    echo '{"id":"codex","module":"@ancientvoid/adapter-codex"}' ;;
    opencode) echo '{"id":"opencode","module":"@ancientvoid/adapter-acp","config":{"preset":"opencode"}}' ;;
    copilot)  echo '{"id":"copilot","module":"@ancientvoid/adapter-acp","config":{"preset":"copilot"}}' ;;
    dsh)      echo '{"id":"dsh","module":"@ancientvoid/adapter-acp","config":{"preset":"dsh"}}' ;;
    pi)       echo '{"id":"pi","module":"@ancientvoid/adapter-pi"}' ;;
    hermes)   echo '{"id":"hermes","module":"@ancientvoid/adapter-hermes"}' ;;
    openai)
      [ -n "$BASE_URL" ] || ask BASE_URL "OpenAI-kompatible baseUrl (llama.cpp/LM Studio/Ollama/vLLM, ohne /v1? mit!)" "http://127.0.0.1:8080/v1"
      [ -n "$MODEL" ] || ask MODEL "Modell-Name" "qwen2.5-coder"
      node -e '
const [baseUrl, model] = process.argv.slice(1);
let url = null;
try { url = new URL(baseUrl); } catch {}
if (!url || !["http:", "https:"].includes(url.protocol)) {
  console.error(`ungültige baseUrl: ${JSON.stringify(baseUrl)} — erwartet http(s)://host:port/v1`); process.exit(2);
}
if (!model.trim() || /[\u0000-\u001f\u007f]/.test(model)) {
  console.error(`ungültiger Modell-Name: ${JSON.stringify(model)} — nicht leer, ohne Zeilenumbrüche/Steuerzeichen`); process.exit(2);
}
process.stdout.write(JSON.stringify({ id: "local-llm", module: "./examples/adapters/openai-compat/adapter.ts", config: { baseUrl, model } }));
' "$BASE_URL" "$MODEL"
      ;;
    *) echo "unbekannter Adapter: $1 (dummy|claude|codex|opencode|copilot|pi|hermes|dsh|openai)" >&2; exit 2 ;;
  esac
}

if [ -z "$ADAPTER" ]; then
  DEFAULT="dummy"; for f in $FOUND; do DEFAULT="$f"; break; done
  echo "  dummy      synthetischer Demo-Adapter (immer lauffähig)"
  echo "  claude codex opencode copilot pi hermes dsh   Harness-CLI (installiert: s. oben)"
  echo "  openai     OpenAI-kompatibler Endpunkt (llama.cpp, LM Studio, Ollama, vLLM)"
  ask ADAPTER "Welcher Provider (erste Installation)" "$DEFAULT"
fi
ADAPTER_JSON="$(adapter_json "$ADAPTER")"
echo "gewählt: $ADAPTER"

# ------------------------------------------------------------- 2 · installieren
say "2/5 npm install (Workspaces, Hooks)"
if [ ! -d node_modules ] || [ ! -f node_modules/.package-lock.json ]; then
  npm install || { echo "npm install fehlgeschlagen" >&2; exit 5; }
else
  npm install --no-fund --no-audit || { echo "npm install fehlgeschlagen" >&2; exit 5; }
fi

# ---------------------------------------------------------------- 3 · Konfigurieren
say "3/5 hub.config.json"
if [ ! -f hub.config.json ]; then
  node - "$ADAPTER_JSON" "$PORT" <<'EOF'
const fs = require("node:fs");
const adapter = JSON.parse(process.argv[2]);
const port = process.argv[3] ? Number(process.argv[3]) : null;
const cfg = JSON.parse(fs.readFileSync("apps/hub/hub.config.example.json", "utf8"));
delete cfg.$comment;
if (port) cfg.server = { ...cfg.server, port };
cfg.adapters = [adapter, ...cfg.adapters.filter((a) => a.id !== adapter.id && a.id !== "dummy")];
fs.writeFileSync("hub.config.json", JSON.stringify(cfg, null, 2) + "\n", { mode: 0o600 });
EOF
  echo "angelegt: hub.config.json (Adapter '$ADAPTER' eingetragen, git-ignored)"
else
  HAVE="$(node -e 'const c=require("./hub.config.json");process.stdout.write((c.adapters??[]).map(a=>a.id).join(" "))')"
  ID="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).id)' "$ADAPTER_JSON")"
  if [[ " $HAVE " == *" $ID "* ]]; then
    echo "bestehende hub.config.json bereits mit Adapter '$ID' — nichts geändert"
  elif [ "$YES" = 1 ]; then
    echo "bestehende hub.config.json ohne '$ID' — --yes ergänzt nicht; manuell eintragen (siehe README)"
  else
    ask ANS "Adapter '$ID' in bestehende Config ergänzen" "ja"
    if [ "$ANS" = ja ]; then
      node - "$ADAPTER_JSON" <<'EOF'
const fs = require("node:fs");
const adapter = JSON.parse(process.argv[2]);
const cfg = JSON.parse(fs.readFileSync("hub.config.json", "utf8"));
cfg.adapters = [...(cfg.adapters ?? []), adapter];
fs.writeFileSync("hub.config.json", JSON.stringify(cfg, null, 2) + "\n");
EOF
      echo "ergänzt: '$ID' in hub.config.json"
    fi
  fi
fi
node -e 'require("./hub.config.json")' || { echo "hub.config.json ist kein gültiges JSON" >&2; exit 3; }
PORT="$(node -e 'try{console.log(require("./hub.config.json").server?.port ?? 7373)}catch{console.log(7373)}' 2>/dev/null || echo 7373)"
HOST="$(node -e 'try{console.log(require("./hub.config.json").server?.host ?? "127.0.0.1")}catch{console.log("127.0.0.1")}' 2>/dev/null || echo 127.0.0.1)"
DATA_DIR="$(node -e 'const {resolve}=require("node:path");process.stdout.write(resolve(require("./hub.config.json").dataDir ?? "./data"))')" || exit 3

# BUG-0132: einen laufenden Hub nur übernehmen, wenn er belegt DIESER ist —
# geprüft vor Token und Start, damit ein Konflikt nichts verändert.
own_hub_pid() { # PID, wenn die Sperre unseres Datenverzeichnisses auf den Prozess zeigt, der auf $PORT lauscht
  local lock="$DATA_DIR/.ancientvoid-hub.pid" pid
  [ -f "$lock" ] || return 1
  pid="$(sed -n 's/^\(hub:\)\{0,1\}\([0-9][0-9]*\)$/\2/p' "$lock")"
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null || return 1
  command -v ss >/dev/null || return 1
  ss -Htlnp "sport = :$PORT" 2>/dev/null | grep -q "pid=$pid," || return 1
  echo "$pid"
}
port_conflict() {
  echo "Konflikt: $*" >&2
  echo "  Nichts geändert — kein Token, kein Start, nichts gestoppt. Anderen Port in hub.config.json" >&2
  echo "  (server.port) eintragen bzw. beim ersten Lauf ./setup.sh --port=<n> wählen." >&2
  exit 6
}
HUB_PID=""; USE_UNIT=0
if [ "$START" = 1 ]; then
  if curl -s -o /dev/null --max-time 2 "http://$HOST:$PORT/" 2>/dev/null; then
    HUB_PID="$(own_hub_pid)" || port_conflict "auf $HOST:$PORT antwortet ein Dienst, der nicht nachweislich zu diesem Checkout gehört (erwartet: PID-Sperre in $DATA_DIR, deren Prozess auf Port $PORT lauscht)."
  elif systemctl --user cat ancientvoid-hub.service >/dev/null 2>&1 && [ "$PORT" = "7373" ]; then
    UNIT_CONFIG="$(systemctl --user show -p Environment --value ancientvoid-hub.service | tr ' ' '\n' | sed -n 's/^ANCIENTVOID_CONFIG=//p')"
    [ "$UNIT_CONFIG" = "$PWD/hub.config.json" ] || port_conflict "die systemd-Unit ancientvoid-hub.service gehört zu einem anderen Checkout (ANCIENTVOID_CONFIG=${UNIT_CONFIG:-?})."
    USE_UNIT=1
  fi
fi

# --------------------------------------------------------------- 4 · PWA + Token
if [ "$PWA" = 1 ]; then
  say "4/5 PWA bauen"; npm -w @ancientvoid/pwa run build
else
  say "4/5 PWA bauen — übersprungen (--no-pwa)"
fi
say "4b/5 Device-Token"
TOKEN_DB="$DATA_DIR/hub.db"
TOKEN_MARKER="$DATA_DIR/.setup-first-token"
mkdir -p "$DATA_DIR" || exit 4
if [ ! -f "$TOKEN_MARKER" ]; then
  TOKEN_OUT="$(node apps/hubctl/src/cli.ts token issue "$LABEL" --db "$TOKEN_DB")" || exit 4
  TOKEN="$(printf '%s\n' "$TOKEN_OUT" | grep -v '^token for' | head -n1)"
  printf '\n  Device-Token für die PWA (einmalig sichtbar!):\n  %s\n\n  Jetzt notieren: PWA öffnen → „Device-Token“ einfügen.\n' "$TOKEN"
  printf '  Weitere Tokens: npm run hubctl -- token issue <name> --db %q\n' "$TOKEN_DB"
  : > "$TOKEN_MARKER"   # nur Marker (git-ignored) — das Token selbst steht NIE auf Disk
else
  echo "bereits ein Token über den Wizard ausgestellt — ausstellbar bei Bedarf:"
  printf '  npm run hubctl -- token issue <name> --db %q\n' "$TOKEN_DB"
fi
if [ "$VOIDWARDEN" = 1 ]; then
  say "4c/5 VoidWarden-Tokens (Kaskade — danach im VoidWarden-Repo ./setup.sh)"
  # hubctl präfixt die Labels selbst: agent:voidwarden (nur lesen) und
  # display:web-1 (lesen + write-Freigaben entscheiden, ADR-0001 Least Privilege).
  # Optionsfragen beantworten (ADR-0066) vergibt der Wizard bewusst nicht.
  HAVE_TOKENS="$(node apps/hubctl/src/cli.ts token list --db "$TOKEN_DB" | awk -F'  created=' '{print $1}')" || exit 4
  issue_once() { # issue_once <label> <hubctl-Argumente…> — nur, wenn das Label noch kein Token hat
    local label="$1"; shift
    if printf '%s\n' "$HAVE_TOKENS" | grep -qxF "$label"; then
      echo "  $label hat bereits ein Token — kein zweites. Verloren? Bewusst neu ausstellen:"
      printf '    npm run hubctl -- token revoke %s --db %q && npm run hubctl -- token issue %s --db %q\n' "$label" "$TOKEN_DB" "$*" "$TOKEN_DB"
    else
      node apps/hubctl/src/cli.ts token issue "$@" --db "$TOKEN_DB" || exit 4
    fi
  }
  issue_once agent:voidwarden voidwarden --agent
  issue_once display:web-1 web-1 --display
  echo "  Neue Tokens (read-only bzw. Freigaben) sind einmalig sichtbar — für"
  echo "  VoidWardens voidwarden.config.json als Dateien ablegen (Modus 600)."
  echo "  Optionsfragen am Display beantworten (ADR-0066) nur bewusst:"
  echo "  token issue web-1 --display --answer-questions (nach revoke display:web-1)."
fi

# ------------------------------------------------------------------ 5 · starten
if [ "$START" = 1 ]; then
  say "5/5 Hub starten"
  # Agents/Shell können ANCIENTVOID_CONFIG ererbt haben (z. B. wenn sie selbst
  # in einer Hub-Session laufen) — der Wizard startet immer gegen DIESE
  # Checkout-Config, die er in Schritt 3 gerade gebaut/geprüft hat.
  if [ -n "${ANCIENTVOID_CONFIG:-}" ] && [ "$ANCIENTVOID_CONFIG" != "$PWD/hub.config.json" ]; then
    echo "Hinweis: ererbtes ANCIENTVOID_CONFIG=$ANCIENTVOID_CONFIG wird für diesen Start"
    echo "         überschrieben (Wizard-Contract: ./hub.config.json dieses Checkouts)."
  fi
  export ANCIENTVOID_CONFIG="$PWD/hub.config.json"
  if [ -n "$HUB_PID" ]; then
    echo "eigener Hub läuft bereits auf Port $PORT (PID $HUB_PID, Datenverzeichnis $DATA_DIR) — kein Start"
  elif [ "$USE_UNIT" = 1 ]; then
    # systemd-Unit übernimmt den Standard-Port (hub.sh-Regel); Aktivieren per
    # systemctl start ist bei laufender Unit ein No-op.
    scripts/hub.sh start || exit 4
  else
    # Eigener Port (oder --port): lokaler Daemon — nie die Unit anfassen.
    HUB_LOCAL=1 scripts/hub.sh start || exit 4
  fi
  for _ in $(seq 1 40); do
    if curl -sf "http://$HOST:$PORT/api/ready" >/dev/null 2>&1; then break; fi; sleep 0.5
  done
  if curl -sf "http://$HOST:$PORT/api/ready" >/dev/null 2>&1; then
    echo "bereit: http://$HOST:$PORT (GET /api/ready = 200)"
  else
    echo "Hub antwortet nicht auf /api/ready — Log: scripts/hub.sh logs" >&2; exit 4
  fi
else
  say "5/5 Hub starten — übersprungen (--no-start); Start: scripts/hub.sh start"
fi

say "fertig"
echo "  PWA:        http://$HOST:$PORT (Device-Token von oben)"
echo "  Handy:      Tailscale + scripts/setup-tailscale-serve.sh $PORT druckt die https-URL (kein öffentlicher Port!);"
echo "              dort im Handy-Browser öffnen und das Device-Token eingeben (nie in die URL hängen;"
echo "              eigenes Token je Gerät: hubctl token issue <label>)"
echo "  VoidWarden: optional, siehe README-Abschnitt „Zusammenspiel mit VoidWarden“"
echo "  Betrieb:    docs/operations-runbook.md (systemd, Updates, Backup)"
