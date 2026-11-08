---
id: BUG-0106
slug: tool-pane-esc-flake
status: open
severity: S4
area: pwa
instance: ci
commit: "3041582801 (docs/p32-evaluations-exit-2, Code von main 324b289)"
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

## Verdachtsrichtung (ungeprüft)

Timing/Fokus: Esc-Handler reagiert möglicherweise nur bei fokussiertem
Pane/Fenster; unter CI-Last könnte der Fokuswohin-anders liegen (benachbarte
windows.spec-Popout-Tests im selben Worker-Kontext?). Keine Aussage ohne
weitere Läufe — bewusst als Beobachtung, nicht als Diagnose.

## Testlücke

Keine — der Test existiert und deckt das Verhalten ab; die Lücke ist
Zuverlässigkeit, nicht Abdeckung.
