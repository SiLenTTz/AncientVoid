---
id: BUG-0122
slug: overlay-hoehen-ohne-ui-zoom-teilung
status: open
severity: S3
area: pwa
instance: dev (Codebefund aus dem EPIC-P50-Audit, 11.11.2026)
commit: "efaa952"
forge: ""
epic: "P50"
created: 2026-11-11
reporter: "Dev (Audit T50.1)"
---

# BUG-0122 — Overlay-Höhen/-Breiten ohne Division durch --ui-zoom

## Gesehen

Codebefund beim EPIC-P50-Audit (T50.1, Tabelle im Epic): Mehrere Overlays,
Blätter und Dialoge begrenzen sich am **Fenster** (`vh`/`dvh`/`vw`), ohne
durch `var(--ui-zoom, 1)` zu teilen. Unter `html { zoom }` sind diese Maße
Layout-Pixel — bei Zoom 130 % kann `max-height: 85vh` rechnerisch 110 % der
Fensterhöhe erreichen, bei 200 % 170 %. Nicht per E2E belegt (kein Repro am
Gerät); rechnerischer Befund, gleiche Ursachenklasse wie BUG-0097/0112/0113.

Betroffen (Datei:Zeile, Stand `efaa952`):

- `12-search.css:139` `.file-viewer` `max-height: 85vh` (Datei-Blatt)
- `11-report-and-diff.css:515 f.` `.review-send-dialog .modal-card` `min(640px, 92vw)` / `85vh`
- `28-forge.css:205 f.` `.fp-trace-dialog .modal-card` `min(760px, 94vw)` / `85vh`
- `25-color-picker.css:30 f.` `.color-dialog` `min(380px, 96vw)` / `94dvh`
- `09-skill-picker.css:26` Skill-Blatt `max-height: 70vh`
- `05-composer.css:31–33` `.composer.expanded .composer-input` `75vh`/`75dvh`/`min-height: 50vh`
- `16-fleet.css:14` `.fleet-qr` `min(220px, 70vw)`, `26-discovery.css:265` `min(80vw, 320px)`, `27-popout.css:151` `min(92vw, 720px)` — Breiten über 50 vw

## Erwartet

Fensterbezogene Maße teilen durch `var(--ui-zoom, 1)` (Muster
`docs/zoom-robuste-flaechen.md`); die Fläche bleibt bei 70–200 % im Fenster.

## Repro

1. `ancientvoid.uiScale` auf 200 % setzen.
2. Eine der Flächen öffnen (z. B. Datei-Blatt mit langer Datei, Composer maximieren).

**Ergebnis nach Schritt 2:** rechnerisch: Höhe > Fenster, Kopf oder Tasten außerhalb.
Noch nicht live bestätigt.

**Häufigkeit:** vermutlich immer (ab Zoom > 100 %)

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | lokal (Codebefund) |
| Commit | `efaa952` |
| Adapter | beliebig |
| Repro-Weg | PWA |

## Logs

Keine — Layout.

## Tests

| Ring | Befehl / Datei | Stand vor dem Fix |
|---|---|---|
| E2E | `e2e/specs/zoom-flaechen.spec.ts` | deckt diese Flächen noch nicht ab |

Ohne Fix rot müsste: je Fläche eine Zeile in der Zoom-Matrix (Fläche
geöffnet, Rechteck im Fenster bei uiScale 200 %).

## Eingrenzung

Siehe Liste oben; Audit-Tabelle im Epic [`EPIC-P50`](../epics/EPIC-P50-zoom-robuste-flaechen.md) §4.

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [ ] GitLab-Issue angelegt
- [ ] offen (Folgearbeit zu EPIC-P50, Fix je Fläche mit Matrix-Zeile)
