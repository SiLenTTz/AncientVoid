#!/usr/bin/env bash
# CI-Repro: läuft die CI-Jobs (verify, optional e2e) in einem sauberen
# Docker-Container im selben Image wie die Pipeline (node:26) — unabhängig
# vom Runner-Zustand. Default ist ein KALTLauf (kein npm-Cache), --warm
# hängt ein Cache-Volume an. Nutzung laut docs/ci-runbook.md, wenn der
# Runner ausgefallen ist oder ein Neuaufbau ohne Cache nachgewiesen werden
# soll (EPIC-P28 T28.2/AC-P28-4).
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
image="${CI_REPRO_IMAGE:-node:26}"
cpus="${CI_REPRO_CPUS:-8}"
memory="${CI_REPRO_MEMORY:-6g}"
run_e2e=0
warm=0
for arg in "$@"; do
  case "$arg" in
    --e2e) run_e2e=1 ;;
    --warm) warm=1 ;;
    *) echo "Unbekannte Option: $arg (erlaubt: --e2e, --warm)" >&2; exit 2 ;;
  esac
done

inner='set -euo pipefail
# Quelle frisch kopieren: kein host-node_modules, kein alter dist —
# nur .git bleibt für check:commits (merge-base gegen origin/main).
mkdir -p /work
# --no-same-owner: alles gehört root im Container, sonst verweigert git
# (dubious ownership) und check:commits überspringt still.
tar -cf - -C /src --exclude=./node_modules --exclude=./apps/pwa/dist \
  --exclude=./test-results --exclude=./playwright-report \
  --exclude=./ci-artifacts --exclude=./data . | tar -xf - -C /work --no-same-owner
cd /work
# CI-Bedingungen wie in der Pipeline (PLAYWRIGHT: 1 Worker, junit, forbidOnly)
export CI=1
node --version && npm --version
apt-get update -qq && apt-get install -y -qq tmux git ffmpeg poppler-utils \
  tesseract-ocr tesseract-ocr-deu tesseract-ocr-eng ripgrep > /dev/null
npm ci
npm rebuild esbuild
npm run check:workspace-links
npm run typecheck
npm run lint
npm run check:commits
npm run check:arch
npm run check:adapter-matrix
npm -w @ancientvoid/pwa run build
mkdir -p test-results
npx vitest run --reporter=junit --reporter=default --outputFile=test-results/vitest-junit.xml
npm run loadtest
if [ "$1" = "1" ]; then
  npx playwright install --with-deps chromium
  npm run test:e2e
fi
echo "CI-Repro im Container erfolgreich (image=$2, e2e=$1)."
'

cache_args=()
if [ "$warm" = "1" ]; then
  cache_args=(-e "npm_config_cache=/npm-cache" -v "ancientvoid-ci-npm-cache:/npm-cache")
  echo "Warmlauf: npm-Cache-Volume ancientvoid-ci-npm-cache wird genutzt."
else
  echo "Kaltlauf ohne npm-Cache (Default)."
fi

exec docker run --rm -i --init \
  --cpus "$cpus" --memory "$memory" \
  -v "$repo":/src:ro \
  "${cache_args[@]}" \
  "$image" bash -c "$inner" -- "$run_e2e" "$image"
