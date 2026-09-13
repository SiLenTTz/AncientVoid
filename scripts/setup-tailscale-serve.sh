#!/usr/bin/env bash
# UACC — Tailscale serve setup (P0, AC-P0-3).
# Exposes the hub on https://<host>.<tailnet>.ts.net without any public port.
#
#   scripts/setup-tailscale-serve.sh [port]
set -euo pipefail

PORT="${1:-7373}"

command -v tailscale >/dev/null || { echo "error: tailscale CLI not found"; exit 1; }
command -v jq >/dev/null || { echo "error: jq not found"; exit 1; }

STATUS="$(tailscale status --json 2>/dev/null || echo '{}')"
if [ "$(echo "$STATUS" | jq -r '.BackendState // "NotRunning"')" != "Running" ]; then
  echo "error: tailscale is not running (BackendState != Running)"
  exit 1
fi

echo "enabling serve on port ${PORT} …"
tailscale serve --bg --https=443 "http://127.0.0.1:${PORT}"

DNS_NAME="$(tailscale status --json | jq -r '.Self.DNSName // empty' | sed 's/\.$//')"
if [ -z "$DNS_NAME" ]; then
  echo "warning: could not determine tailnet DNS name — check 'tailscale status'"
else
  echo
  echo "hub reachable at:  https://${DNS_NAME}"
  echo "verify with:       curl -s https://${DNS_NAME}/api/health"
  echo
  echo "device-token auth is enforced by the hub itself (401 without token)."
  echo "optionally set \"enforceTailnetIdentity\": true in hub.config.json"
  echo "so requests must arrive via the tailnet (Tailscale-User-Login header)."
fi
echo
tailscale serve status
