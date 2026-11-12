---
id: BUG-0145
slug: fab-verdeckt-verlaufsende
status: done
severity: S2
area: pwa
instance: dev
commit: "c8dc67f"
forge: ""
epic: ""
created: 2026-11-12
reporter: "Claude — volle E2E-Suite auf main"
---

# BUG-0145 — Voice-FAB verdeckt das Ende des Verlaufs auf Handy und Tablet

## Gesehen

Volle E2E-Suite auf main (`c8dc67f`): `deeplink.spec.ts:41` (mobile) rot, isoliert 5/5 rot. Die „Kopieren“-Taste der letzten Zeile in der Weiterarbeiten-Karte (Bericht) liegt unter dem Voice-FAB; Playwright meldet „nyx-fab … intercepts pointer events“. Ein Mensch kann die Taste ebenfalls nicht treffen.

## Ursache

Seit dem größeren FAB (64 px) und BUG-0138 steht der FAB auf Handy und Tablet rechts unten direkt über dem Dock. Der Verlauf (`.tail-scroll`) endet genau an der Dock-Oberkante; sein letztes Stück lässt sich nicht weiter hochscrollen und bleibt dauerhaft unter dem FAB.

## Fix

`43-nyx-fab.css`: Solange ein FAB im Handy- oder Tablet-Modus da ist, bekommt `.tail-scroll` unten 80 px Platz (FAB 64 px + Abstand). Damit lässt sich jedes Verlaufsende über den FAB scrollen.

## Tests

| Ring | Datei | vor dem Fix |
|---|---|---|
| E2E | `nyx-fab.spec.ts` „BUG-0145: das Ende des Verlaufs lässt sich über den FAB scrollen“ | rot |
| E2E | `deeplink.spec.ts:41` | rot (5/5) |
