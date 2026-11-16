---
id: BUG-0139
slug: e2e-specs-lesen-title-statt-data-tip
status: done
severity: S3
area: e2e
instance: dev
commit: "160f670"
forge: ""
epic: "EPIC-P43"
created: 2026-11-12
reporter: "Claude — volle E2E-Suite auf main"
---

# BUG-0139 — E2E-Specs lesen `title`, das der Tooltip-Layer längst in `data-tip` verschoben hat

## Gesehen

Vier Tests rot auf main: `kleinkram` Regel 5 (17 Tasten „ohne Tooltip“), `layout-desktop` (Dateibaum-`title` leer), `navigation-desktop` ×2 (`.dock-item[title="Einstellungen"]` nie gefunden, 45-s-Timeout).

## Erwartet

Die Specs prüfen den Tooltip dort, wo er seit `db2907f` liegt.

## Eingrenzung

`apps/pwa/src/shared/Tooltip.tsx` `adoptTitle` verschiebt `title` bewusst nach `data-tip` (eigener Tooltip-Layer, Touch-Gedrückthalten). Die Specs wurden im selben Commit nicht nachgezogen. Kein Produktfehler.

## Fix

Specs lesen `data-tip` (bzw. `title || data-tip`); `tastatur-screenreader` und `layout` bekommen denselben Fallback, damit sie nicht zufällig grün bleiben.

## Tests

| Ring | Datei | vor dem Fix |
|---|---|---|
| E2E | `kleinkram` R5, `layout-desktop`, `navigation-desktop` | rot |
