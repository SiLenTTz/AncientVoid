---
id: BUG-0107
slug: selection-copy-ci-flake
status: open
severity: S4
area: pwa
instance: ci
commit: "Pipeline 17841782330 (fix/reviews-test-git-init-await, Code = main-Stand)"
forge: ""
epic: "EPIC-P9-2-Testgut (AI-P9-2-Umfeld)"
created: 2026-11-08
reporter: "CI-Lauf MR !328"
---

# BUG-0107 — Clipboard-Test „fertige Auswahl im Clipboard" flakt in CI

## Gesehen

`e2e/specs/selection-copy.spec.ts:10` (desktop) fällt intermittierend in CI:
nach Textauswahl liegt der erwartete Text nicht (rechtzeitig) im Clipboard.
Pipeline von !328 (Job 17841782330, 13:47Z), 371 weitere Tests grün —
darunter derselbe Test in den Pipelines von !323 (09:07Z, ✓), !326 (✓) und
im lokalen Komplettlauf (372 passed, 08.11.2026).

## Erwartet

Auswahl landet zuverlässig im Clipboard; Test deterministisch grün wie in
vier anderen Läufen desselben Tages.

## Repro

CI-only beobachtet (Runner `av-docker`, Chromium headless): 1 von ~5
Komplettläufen. Lokal nicht reproduziert.

## Logs/Evidenz

- Fail: Job 17841782330, Trace 13:47:09Z (12,3 s bis zum Fehlschlag).
- Pass: Pipeline 3041493718 Test #206 (2,0 s), Pipeline 3041805411 (✓),
  lokaler Lauf 372 passed.

## Verdachtsrichtung (geprüft: Host-Last)

Nachtrag 08.11.2026 (Retry-Kette MR !328): Der Flake gehört zu einem
**CI-Instabilitätscluster** — vier verschiedene, jeweils unveränderte Tests
fielen einzeln über vier Komplettläufe, alle in anderen Läufen desselben
Tages grün: tool-pane:70 (2×, BUG-0106), selection-copy:10 (dieser Bug),
auth:43 mobile (auch schon Pipeline von !321 am 08.11. früh), skill-picker
workspace:208. Der Runner `av-docker` teilt sich den Alltagshost (Last 6–8
von 16 Kernen durch Desktop-Arbeit: Streaming/Browser/Dienste) — die
BUG-0092-Klasse (timing-sensible E2E unter Nebenlast), jetzt nicht mehr nur
bei lokalen Vollläufen, sondern im CI-Betrieb selbst.

## Testlücke

Keine — Test existiert; Zuverlässigkeit ist das Problem, nicht Abdeckung.
Offene Frage (für Endabnahme/Runbook): Runner auf ruhigeren Host ziehen
oder Flake-anfällige Tests mit Lasttoleranz (längere Timeouts/Retries)
absichern.
