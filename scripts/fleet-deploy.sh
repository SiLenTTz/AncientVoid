#!/usr/bin/env bash
# EPIC-P6 T6.5: install or update an AncientVoid hub on another machine of the fleet.
#
#   scripts/fleet-deploy.sh <ssh-target> <host-id> <tailnet-ip> <project-root> [adapters-json]
#
# - Code: `git archive HEAD` of this checkout → ~/AncientVoid, plus the built PWA.
# - Config: ~/.config/ancientvoid/hub.config.json, written only if it does not exist.
# - Data: ~/.local/share/ancientvoid. Service: systemd --user unit ancientvoid-hub (needs linger).
# - Listens only on the tailnet IP (port 7373): reachable in the tailnet,
#   not on the LAN or the internet. No sudo.
#
# adapters-json defaults to [] (a hub for discovery/monitoring only).
set -euo pipefail
cd "$(dirname "$0")/.."

target="${1:?ssh target, e.g. dev@home-server}"
host_id="${2:?host id, e.g. home-server}"
tailnet_ip="${3:?tailnet ip of that machine}"
project_root="${4:?project root on that machine}"
adapters="${5:-[]}"

if ! git diff --quiet HEAD; then
  echo "uncommitted changes — deploy only committed code" >&2
  exit 1
fi
[ -f apps/pwa/dist/index.html ] || npm -w @ancientvoid/pwa run build

echo "== code $(git rev-parse --short HEAD) → $target:~/AncientVoid"
# Code dirs are replaced, not merged: files moved away in the repo must not
# linger as stale workspaces (ADR-0020 moved packages/server to apps/hub).
git archive --format=tar HEAD | ssh "$target" 'mkdir -p ~/AncientVoid && rm -rf ~/AncientVoid/apps ~/AncientVoid/packages && tar -x -C ~/AncientVoid'
tar -c -C apps/pwa dist | ssh "$target" 'mkdir -p ~/AncientVoid/apps/pwa && rm -rf ~/AncientVoid/apps/pwa/dist && tar -x -C ~/AncientVoid/apps/pwa'

echo "== dependencies"
ssh "$target" 'cd ~/AncientVoid && PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm ci --no-audit --no-fund --loglevel=error'

echo "== config and service"
# ssh re-joins arguments into one remote command line (quotes in the JSON
# would get lost) — pass them base64-encoded.
enc() { printf '%s' "$1" | base64 -w0; }
ssh "$target" bash -s -- "$(enc "$host_id")" "$(enc "$tailnet_ip")" "$(enc "$project_root")" "$(enc "$adapters")" <<'REMOTE'
set -euo pipefail
dec() { printf '%s' "$1" | base64 -d; }
host_id="$(dec "$1")"; tailnet_ip="$(dec "$2")"; project_root="$(dec "$3")"; adapters="$(dec "$4")"
config="$HOME/.config/ancientvoid/hub.config.json"
mkdir -p "$HOME/.config/ancientvoid" "$HOME/.local/share/ancientvoid" "$HOME/.config/systemd/user" "$project_root"
chmod 700 "$HOME/.local/share/ancientvoid"
# ADR-0020: configs written before the move point pwaDir at packages/pwa.
[ -f "$config" ] && sed -i 's#/AncientVoid/packages/pwa/dist#/AncientVoid/apps/pwa/dist#' "$config"
if [ ! -f "$config" ]; then
  cat > "$config" <<JSON
{
  "hostId": "$host_id",
  "dataDir": "$HOME/.local/share/ancientvoid",
  "workerRunner": "tmux",
  "projectRoots": ["$project_root"],
  "server": { "host": "$tailnet_ip", "port": 7373, "pwaDir": "$HOME/AncientVoid/apps/pwa/dist" },
  "adapters": $adapters
}
JSON
  echo "config written: $config"
else
  echo "config kept: $config"
fi
cat > "$HOME/.config/systemd/user/ancientvoid-hub.service" <<UNIT
[Unit]
Description=AncientVoid hub ($host_id)
After=network-online.target

[Service]
WorkingDirectory=%h/AncientVoid
Environment=ANCIENTVOID_CONFIG=%h/.config/ancientvoid/hub.config.json
Environment=PATH=%h/.local/share/mise/shims:%h/.local/bin:/usr/local/bin:/usr/bin:/bin
ExecStart=$(command -v node) apps/hub/src/main.ts
# BUG-0029: logs and data stay private to the user.
UMask=0077
# BUG-0037: restart also after a clean SIGTERM exit; an explicit systemctl stop still suppresses restarts.
Restart=always
RestartSec=3
# BUG-0072: the tmux workers live in this unit's cgroup. The default (control-group) kills them on every
# restart or crash and cuts running turns off; "process" stops only the hub itself, the new hub adopts
# the workers (ADR-0014).
KillMode=process

[Install]
WantedBy=default.target
UNIT
systemctl --user daemon-reload
systemctl --user enable ancientvoid-hub.service >/dev/null
systemctl --user restart ancientvoid-hub.service
REMOTE

echo "== health over the tailnet"
for _ in $(seq 1 30); do
  if curl -fsS "http://$tailnet_ip:7373/api/fleet/hello" 2>/dev/null; then echo; exit 0; fi
  sleep 1
done
echo "hub on $host_id did not answer — journalctl --user -u ancientvoid-hub on the host" >&2
exit 1
