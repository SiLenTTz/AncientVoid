---
id: BUG-0105
slug: gewaehlter-harness-startet-nicht
status: done
severity: S2
area: pwa
instance: live
epic: "P35"
created: 2026-11-07
reporter: "Nutzer (PWA, Meldung 07.11.2026: „Ich hatte eigentlich Codex ausgewählt.“)"
---

# BUG-0105 — Gewählter Harness startet nicht: stiller Treiber-Reset, Wahl überlebt Remount nicht

## Gesehen

Live (07.11.2026): Nutzer hatte im Startformular codex ausgewählt — die
gestartete Session lief als claude (Screenshot: „AncientVoid · claude“).

## Erwartet

Die im Formular gewählte Harness-/Treiber-Kombination wird gestartet — oder
die Abweichung ist vor dem Start sichtbar begründet. Nie ein stiller Tausch.

## Repro

1. **Stiller Treiber-Reset** (`apps/pwa/src/features/new-session/CreateSession.tsx:188–190`):
   Adapter codex wählen, dann Loop `securesight-factory` wählen → der Effekt
   setzt den Treiber still auf claude zurück (nur claude/maki sind
   Factory-Treiber). Der Nutzer sieht die Ersetzung nicht — das Startformular
   zeigt „Factory-Treiber: claude“, obwohl er codex gewählt hatte.
2. **Wahl überlebt keinen Remount** (`CreateSession.tsx:55`, `:231`): Die
   Adapter-Auswahl wird erst bei Submit in `ancientvoid.newSession.last`
   gespeichert. Wer codex wählt, wegnavigiert und zurückkehrt (oder neu
   lädt), bekommt den zuletzt *gestarteten* Adapter (z. B. claude) — wählt
   nicht noch einmal nach und startet den falschen Harness.

## Ursache

1. Der Einschränkungs-Effekt korrigiert den Wert, ohne die Ersetzung zu sagen
   (Verstoß gegen fail loud, PRD §8-Geist).
2. Die Merkung (`LAST_KEY`) wird nur im Submit-Pfad geschrieben — die Wahl
   selbst ist flüchtiger Komponentenzustand.

## Fix

`CreateSession.tsx` (EPIC-P35 T35.2):

1. Der Einschränkungs-Effekt meldet die Ersetzung als `role="status"`-Hinweis
   („Factory-Treiber läuft nur mit claude oder maki — ‚codex‘ wurde ersetzt“);
   eine eigene Wahl im Dropdown löscht den Hinweis.
2. `setAdapter` schreibt die Wahl sofort in `ancientvoid.newSession.last`
   (Spread um Host/Projekt/Loop zu erhalten) — Remount/Reload behalten sie.

## Tests

`e2e/specs/factory.spec.ts`: codex wählen → Loop securesight → Treiber steht
auf claude UND der Hinweis nennt die Ersetzung (ohne Fix rot: kein Hinweis).
`e2e/specs/modus-modell.spec.ts`: codex wählen → Reload → Wahl steht; pi
wählen → Übersicht → Neue Session → Wahl steht (ohne Fix rot: dummy).
