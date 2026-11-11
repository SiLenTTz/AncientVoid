---
id: BUG-0118
slug: session-menue-unter-steuerung
status: done
severity: S3
area: pwa
instance: dev
commit: "4c37a81"
forge: ""
epic: "EPIC-P43 T43.0"
created: 2026-11-11
reporter: "Claude"
---

# BUG-0118 — Untere Punkte des Session-Menüs liegen in einer niedrigen Kachel unter der Steuerung

## Gesehen

Am PC bei 1280×720 mit einer Kachel: „⋯“ im Session-Kopf klappt sechs Punkte auf. Der letzte,
„Auftrag in Worten“, liegt unter der Steuerung am unteren Kachelrand (Modus/Modell) und nimmt
keinen Klick an. Häufigkeit: immer bei dieser Fensterhöhe.

## Erwartet

Das aufgeklappte Menü liegt über der Steuerung; jeder Punkt ist klickbar.

## Repro

1. Hub mit einer Session (Adapter `claude`), Fenster 1280×720.
2. Session in Kachel 1 öffnen, „⋯“ klicken.
3. „Auftrag in Worten“ klicken.

**Ergebnis nach Schritt 3:** der Klick landet auf `.session-configure` in `.dock-stack`.

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | E2E-Hub (Playwright, Projekt `desktop`) |
| Commit | `4c37a81` |
| Adapter | claude (Attrappe) |
| Repro-Weg | PWA |

## Logs

```text
<div class="session-configure">…</div> from <div class="dock-stack">…</div> subtree intercepts pointer events
```

## Tests

| Ring | Befehl / Datei | Stand vor dem Fix |
|---|---|---|
| E2E | `e2e/specs/funktionsinventar.spec.ts` (Eintrag S18, Projekt `desktop`) | rot |

## Eingrenzung

`apps/pwa/src/app/styles/02-layout.css` (`.topbar`, z-index 10) und `10-voice-and-dock.css`
(`.dock-stack`, z-index 10): gleicher Rang, die Steuerung steht später im DOM.

## Fix

`.session-topbar` erhält z-index 11. Gefunden vom Funktionsinventar (EPIC-P43 T43.0); derselbe
Eintrag ist der Regressionstest.

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [ ] GitLab-Issue angelegt — nicht angelegt, Fund und Fix im selben MR
- [x] `bugfix`
