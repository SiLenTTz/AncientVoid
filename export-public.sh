#!/bin/bash
# export-public.sh — sanitärer öffentlicher Export von AncientVoid.
# Muster wie brain-indexer: privates Repo weiterentwickeln, vor jedem
# Release erneut laufen lassen. Internes (epics/bugs/Messläufe/Live-Config,
# interne Hostnamen/Pfade) bleibt draußen bzw. wird geschwärzt.
# Aufruf: bash export-public.sh [ziel] [release-name]
set -euo pipefail
SRC="$(cd "$(dirname "$0")" && pwd)"
DST="${1:-$HOME/projects/private/SiLenT_Tz/AncientVoid-public}"
REL="${2:-}"

EXCLUDE=(.git node_modules data playwright-report test-results bugs epics dist
         docs AGENTS.md hub.config.json .env .env.* "*.log" coverage .tmp
         export-public.sh dist
         .claude .opencode .codex .cursor .codeium .amp .venv .cache)
mkdir -p "$DST"
rsync -a --delete --delete-excluded "${EXCLUDE[@]/#/--exclude=}" "$SRC"/ "$DST"/

# Kuratierte (öffentlich geeignete) Docs zurückkopieren
mkdir -p "$DST/docs"
for f in architecture.md adapters.md configuration.md operations-runbook.md backup-restore.md; do
  [ -f "$SRC/docs/$f" ] && cp "$SRC/docs/$f" "$DST/docs/$f"
done
cp -r "$SRC/docs/assets" "$DST/docs/assets"

# Interne Hostnamen/Pfade/Kennungen schwärzen (Textdateien)
grep -rlZ -E 'tail6d2826|silenttz|shadow-jan|/mnt/omarchy_data' "$DST" \
  --include='*.md' --include='*.json' --include='*.ts' --include='*.js' --include='*.mjs' --include='*.cjs' \
  --include='*.sh' --include='*.yml' --include='*.yaml' --include='*.html' --include='*.css' 2>/dev/null \
| xargs -0 -r sed -i \
    -e 's|[a-z0-9-]*\.tail6d2826\.ts\.net|<tailnet-host>|g' \
    -e 's|/home/silenttz|~|g' \
    -e 's|/mnt/omarchy_data/30_repos/arch/arbeitsbaeume|~|g' \
    -e 's/shadow-jan@hotmail\.de/SiLenTTz@users.noreply.github.com/g' -e 's/silenttz-server/example-peer/g'

cd "$DST"
if [ ! -d .git ]; then
  git init -q -b main
  git add -A
  git -c user.name=SiLenTTz -c user.email=SiLenTTz@users.noreply.github.com \
    commit -q -m "Initial public release — local-first command center for coding agents (hub, PWA, adapters)"
else
  git add -A
  if git diff --cached --quiet; then
    echo "Keine Änderungen seit dem letzten Export."
  else
    git -c user.name=SiLenTTz -c user.email=SiLenTTz@users.noreply.github.com \
      commit -q -m "${REL:-Release $(date +%Y-%m-%d)}"
    echo "Release committet."
  fi
fi
echo "Export: $DST — VOR dem Push selbst auditieren (grep -rE 'tail6d2826|silenttz|shadow-jan|token')."
