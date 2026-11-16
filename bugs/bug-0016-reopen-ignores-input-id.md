---
id: BUG-0016
slug: reopen-ignores-input-id
status: done
severity: S1
area: core
instance: dev
commit: ""
forge: ""
epic: "EPIC-P5 T5.5 / AC-P5-4"
created: 2026-09-23
reporter: "Claude Opus 5.5 (P5-Statusanalyse)"
---

# BUG-0016 — Wiederholte Eingabe startet eine gestoppte Session zweimal

## Gesehen

Eine gestoppte Session bekommt einen Prompt mit `inputId: "in-1"` und läuft
wieder an. Wird sie gestoppt und derselbe Prompt mit derselben `inputId`
erneut geschickt, startet der Provider ein zweites Mal. Beide Antworten sind
`{ ok: true }`.

## Erwartet

Die zweite Anfrage antwortet `{ ok: true, detail: "duplicate input ignored" }`
und startet nichts (AC-P5-4: einmalige Ausführung).

## Repro

1. Session mit dem Dummy-Adapter anlegen, dann stoppen.
2. `steer(id, prompt "weiter", { inputId: "in-1" })` → Provider-Start Nr. 2.
3. Stoppen, Schritt 2 wiederholen.

**Ergebnis nach Schritt 3:** Provider-Start Nr. 3, `inputRevision` bleibt 0.

**Häufigkeit:** immer.

## Eingrenzung

`packages/core/src/sessionmanager.ts`, `steer()`: der Weiter-Pfad
`continueStopped()` kam mit `return` zurück, bevor `commitSteerMeta()` lief.
Eingabe-ID, Revision und Writer-Lease wurden für diesen Pfad nie
geschrieben. Eingeführt mit `92956d1`.

## Fix

Nach erfolgreichem `continueStopped()` wird `commitSteerMeta()` aufgerufen,
genau wie nach einem normalen Steer.

## Tests

| Ring | Datei | ohne Fix | mit Fix |
|---|---|---|---|
| Unit | `packages/core/test/steer-reopen.test.ts` „BUG-0016“ | rot (`{ ok: true }` statt Duplikat) | grün |

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [ ] GitLab-Issue
- [x] `bugfix`
