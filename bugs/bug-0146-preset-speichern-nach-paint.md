---
id: BUG-0146
slug: preset-speichern-nach-paint
status: done
severity: S3
area: pwa
instance: dev
commit: "46bbeb3"
forge: ""
epic: "EPIC-P1"
created: 2026-11-12
reporter: "Claude — volle E2E-Suite auf main"
---

# BUG-0146 — Verlauf-Preset wird erst nach dem Zeichnen gespeichert

## Gesehen

Volle E2E-Suite auf main: `session.spec.ts:292` (AC-P1-4, mobile) rot — nach dem Neuladen ist wieder „Überwachen“ aktiv statt „Debuggen“. Isoliert 5/5 grün.

## Ursache

`SessionTail.tsx` schreibt `ancientvoid.filter` in einem `useEffect`; Preact führt ihn erst nach dem nächsten Frame aus. Zwischen „Taste sichtbar aktiv“ und „gespeichert“ liegt also ein Fenster; unter Last fällt ein Neuladen hinein (auch für Menschen möglich, nur seltener).

## Fix

Speichern per `useLayoutEffect` — im selben Commit, in dem die Wahl sichtbar wird.

## Tests

| Ring | Datei | vor dem Fix |
|---|---|---|
| E2E | `session.spec.ts` „BUG-0146: sobald das Preset sichtbar gewählt ist, ist es schon gespeichert“ (MutationObserver liest den Speicher beim Umschalten der Klasse) | rot, 3/3 deterministisch |
| E2E | `session.spec.ts:292` AC-P1-4 | rot unter Volllast |
