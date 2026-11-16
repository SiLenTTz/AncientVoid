#!/usr/bin/env bash
# Live smoke after an epic: temporary token → Playwright (read-only) → revoke.
#   scripts/test-live.sh [hub-url] [hub.db]
set -euo pipefail
cd "$(dirname "$0")/.."
url="${1:-http://127.0.0.1:7373}"
db="${2:-./data/hub.db}"
label="live-smoke-$(date +%s)"
token=$(node apps/hubctl/src/cli.ts token issue "$label" --db "$db" | grep -v "^token for" | tr -d '[:space:]')
trap 'node apps/hubctl/src/cli.ts token revoke "$label" --db "$db" >/dev/null' EXIT
ANCIENTVOID_LIVE_URL="$url" ANCIENTVOID_LIVE_TOKEN="$token" npx playwright test -c playwright.live.config.ts
