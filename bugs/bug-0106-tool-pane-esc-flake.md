---
id: BUG-0106
slug: tool-pane-esc-flake
status: done
severity: S4
area: pwa
instance: ci
commit: "fix/ci-flake-cluster (MR !330)"
forge: ""
epic: "EPIC-P34 (T34.2-Testgut)"
created: 2026-11-08
reporter: "CI-Lauf MR !324"
---

# BUG-0106 — Esc schließt die Werkzeugfläche sporadisch nicht (CI-Flake)

## Gesehen

`e2e/specs/tool-pane.spec.ts:70` („Esc schließt die Werkzeugfläche …") schlägt
intermittierend in CI fehl: nach `Escape` bleibt `.tool-pane` sichtbar
(`toHaveCount(0)` → erhalten 1, 24× über 10 s). Pipeline 3041582801
(Job-Trace 09:19:32Z), Branch ohne PWA-Änderungen (7 Markdown-Dateien).

## Erwartet

Esc schließt die Werkzeugfläche zuverlässig; der Test ist in derselben
Codebasis 20 Minuten zuvor (Pipeline 3041493718, Test 364 ✓) grün gelaufen —
gleiches Commit-Programmverhalten, anderer Ausgang → nichtdeterministisch.

## Repro

CI-only bislang (Runner `av-docker`, Chromium, `desktop`-Projekt):

1. `npm run test:e2e` komplett laufen lassen.
2. Mit etwas Wahrscheinlichkeit fällt `tool-pane.spec.ts:70` (Erstauftreten
   beobachtet am 08.11.2026, 1 von 2 Läufen).

Lokal (08.11.2026) nicht reproduziert; Einzeltest mehrfach grün.

## Logs/Evidenz

- Fail: Pipeline 3041582801, Job 1784…-Trace, Abschnitt „1) [desktop] ›
  e2e/specs/tool-pane.spec.ts:70".
- Pass: Pipeline 3041493718 (Test #364, 2.2 s), gleicher Baumstand.

## Verdachtsrichtung (geprüft: bestätigt)

Root cause (file:line): `apps/pwa/src/features/shell/ToolPane.tsx` hängt den
Esc-KeyListener in `useEffect` an; **Preact 11 spült passive Effekte erst im
nächsten requestAnimationFrame** (hooks.mjs: Flush via `requestAnimationFrame`).
Die Pane ist damit sichtbar, BEVOR der Listener existiert. Der CI-Trace zeigt
den Press 7 ms nach Sichtbarkeitsauflösung — das synthetische Keydown landet
in dieser Lücke und ist verloren (kein Listener, kein Retry).

## Fix

`useLayoutEffect` statt `useEffect`: Listener hängt synchron beim DOM-Commit —
Lücke geschlossen (fix/ci-flake-cluster). Rot-Grün: der CI-Trace zweier
Läufe ist der rote Beleg; lokal 5×  unter Last grün, komplette Suite grün.

## Testlücke

Keine — der Test existiert und deckt das Verhalten ab; die Lücke ist
Zuverlässigkeit, nicht Abdeckung.
