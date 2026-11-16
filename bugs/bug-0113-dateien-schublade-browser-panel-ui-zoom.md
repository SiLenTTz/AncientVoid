---
id: BUG-0113
slug: dateien-schublade-browser-panel-ui-zoom
status: done
severity: S3
area: pwa
instance: dev (Codebefund 10.11.2026, gleiche Ursachenklasse wie BUG-0112)
commit: "2cefb78"
epic: "P50"
created: 2026-11-10
reporter: "Dev (Scan)"
---

# BUG-0113 — Dateien-Schublade und Browser-Panel falsch vermessen bei UI-Zoom

## Gesehen

Codebefund beim BUG-0112-Scan (10.11.2026): Dieselbe Ursachenklasse —
`dvh`-Höhen ohne Division durch `--ui-zoom` — steckt noch in zwei
fest positionierten Flächen der Session-Ansicht:

- `apps/pwa/src/app/styles/30-files.css:6` — `.files-sidebar.drawer`
  `height: 85dvh`: Bei Zoom 130 % wird die Schublade visuell ~110 % des
  Fensters hoch, der Kopf (Projektwahl, Schließen) liegt über dem
  oberen Fensterrand und ist nicht mehr erreichbar.
- `apps/pwa/src/app/styles/30-files.css:87` — `.browser-panel`
  `top: 4dvh`: wandert bei Zoom aus der Ecke; `width: min(760px, 100vw)`
  ist ebenfalls zoom-verzerrt.

Kein Seiten-Scroll (beide sind `position: fixed`), aber dieselbe
Invariantenverletzung: Flächen passen bei UI-Zoom ≠ 100 % nicht ins Fenster.

## Erwartet

Beide Flächen teilen ihre fensterbezogenen Maße durch
`var(--ui-zoom, 1)` — Muster wie `02-layout.css:73` (BUG-0099) und
`14-notifications.css:104 f.`.

## Repro

1. `ancientvoid.uiScale` auf 130 % setzen.
2. Session öffnen, Dateien-Schublade (Reiter „Dateien") öffnen.

**Ergebnis nach Schritt 2:** Schubladen-Kopf oberhalb des Fensters;
bei sehr kleinem Fenster ebenso.

**Häufigkeit:** immer (ab Zoom ≠ 100 %)

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | lokal (Playwright) |
| Commit | `2cefb78` |
| Adapter | beliebig |
| Repro-Weg | PWA |

## Logs

Keine — Layout.

## Tests

| Ring | Befehl / Datei | Stand vor dem Fix |
|---|---|---|
| E2E | `e2e/specs/project-explorer.spec.ts` | grün — nur ohne Zoom |

Ohne Fix rot müsste: Schubladen-Kopf sichtbar bei `uiScale=1.3`
(`.files-head` vollständig im Viewport).

## Fix (11.11.2026)

`30-files.css`: `.files-sidebar.drawer` `height: calc(85dvh / var(--ui-zoom, 1))`;
`.browser-panel` `top: calc(4dvh / var(--ui-zoom, 1))` und
`width: min(760px, calc(100vw / var(--ui-zoom, 1)))` (Muster BUG-0099,
`02-layout.css`).

## Nachweis

E2E `e2e/specs/zoom-flaechen.spec.ts` (mobile, `uiScale=1.3`): ohne Fix
rot (Browser-Panel „links 124 px außerhalb", Schublade ragt über den
oberen Rand), mit Fix grün — Schublade und Kopf liegen im Fenster,
Schubladen-Unterkante == Fensterhöhe ±1 px.

## Eingrenzung

`apps/pwa/src/app/styles/30-files.css:6` und `:87` — siehe oben.

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [ ] GitLab-Issue angelegt
- [x] erledigt (EPIC-P50 T50.2)
