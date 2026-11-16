---
id: BUG-0122
slug: overlay-hoehen-ohne-ui-zoom-teilung
status: done
severity: S3
area: pwa
instance: dev (Codebefund aus dem EPIC-P50-Audit, 11.11.2026)
commit: "efaa952"
forge: ""
epic: "P50"
created: 2026-11-11
reporter: "Dev (Audit T50.1)"
fixed: 2026-11-11
---

# BUG-0122 — Overlay-Höhen/-Breiten ohne Division durch --ui-zoom

## Gesehen

Codebefund beim EPIC-P50-Audit (T50.1): Mehrere Overlays, Blätter und Dialoge
begrenzten sich am Fenster (`vh`/`dvh`/`vw`) ohne `var(--ui-zoom, 1)`.

## Erwartet

Fensterbezogene Maße teilen durch `var(--ui-zoom, 1)` (Muster
`docs/zoom-robuste-flaechen.md`); die Fläche bleibt bei 70–200 % im Fenster.

## Fix (11.11.2026)

Alle neun Audit-Zeilen teilen jetzt durch `--ui-zoom`:

- `05-composer.css` (Composer maximiert)
- `09-skill-picker.css` (`.overlay-sheet`)
- `11-report-and-diff.css` (Review-Dialog)
- `12-search.css` (`.file-viewer`)
- `25-color-picker.css` (`.color-dialog`)
- `28-forge.css` (Trace-Dialog)
- `16-fleet.css` (`.fleet-qr`)
- `26-discovery.css` (`.card-menu-body`)
- `27-popout.css` (`.restore-bar`)

E2E: `e2e/specs/zoom-flaechen.spec.ts` „BUG-0122: Overlay-Maße bleiben bei Zoom 200 % im Fenster“ — vor dem Fix hätten ungeteilte `85vh` das Layout-Fenster überschritten.

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [ ] GitLab-Issue angelegt
- [x] done (EPIC-P50 Abschluss)
