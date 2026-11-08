---
id: BUG-0107
slug: selection-copy-ci-flake
status: done
severity: S4
area: pwa
instance: ci
commit: "fix/ci-flake-cluster (MR !330)"
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

## Root causes und Fixes (fix/ci-flake-cluster, alle mit Trace-/Code-Beleg)

Drei unabhängige Ursachen, alle unter Host-Last:

1. **selection-copy:10** — `SessionTail.tsx` schluckte eine transient
   abgelehnte `clipboard.writeText` still (`.catch(() => undefined)`), obwohl
   der Feature-Vertrag „Auswahl wird nie still verloren, Flash ist der Beleg"
   lautet. Fix: `copy-selection.ts:copyWithRetry` — genau ein gebundener
   Retry; rot-grün unit-getestet (3 Tests), Flash weiterhin nur bei echtem
   Erfolg.
2. **workspace:208 (Skill-Picker)** — Trace/Snapshot: Sheet zeigte
   „project query param required". `SkillOverlay.tsx` feuerte die
   Skills-Abfrage beim Öffnen mit Projekt "" (Projektliste unter Last noch
   nicht geladen) und nie nach. Fix: Abfrage nur mit Projekt + Effect-Refetch
   beim Eintreffen/Wechsel des Projekts; leerer Zustand sagt „Projekt wird
   noch geladen …".
3. **auth:43** — „Tearing down hub exceeded the test timeout":
   `e2e/support/hub.ts:kill()` wartete unbegrenzt auf SIGTERM-Shutdown.
   Fix: 5 s Grace, dann SIGKILL (Test-Hub, keine Produkt-Semantik).

Der vierte Cluster-Beobachtungspunkt (auth:43 auch in !321) ist mit 3.
abgedeckt. Fünftes Mitglied während des Fix-MRs selbst (Pipeline 3042625158):
**resize:8** — das Schrumpfen des Eingabefelds nach dem Leeren wurde sofort
gemessen, obwohl Auto-Grow/-Shrink erst nach dem Re-Render greift; das
Wachsen hatte dieselbe Race bereits per `expect.poll` (BUG-0094-Nachtrag).
Fix: dieselbe Poll-Form auch fürs Schrumpfen. Der
Verbessern/Empfehlung-Flake (workspace:174) trat einmalig auf und bleibt
beobachtet.

## Testlücke

Keine — Test existiert; Zuverlässigkeit ist das Problem, nicht Abdeckung.
Offene Frage (für Endabnahme/Runbook): Runner auf ruhigeren Host ziehen
oder Flake-anfällige Tests mit Lasttoleranz (längere Timeouts/Retries)
absichern.
