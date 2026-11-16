---
id: BUG-0187
slug: geister-tokens-fremde-fallback-farben
status: open
severity: S3
area: pwa
instance: dev
commit: "08c492a0"
forge: ""
created: 2026-11-16
reporter: "UI-Styling-Audit 2026-11-16"
---

# BUG-0187 — Geister-Tokens mit fremder Fallback-Palette im Diff-, Dateien- und Arbeitsort-Styling

## Gesehen

Rahmen, Hintergründe und Statusfarben in Diff-Review, Dateien-Schublade und
Arbeitsort-Auswahl bleiben im hellen Thema dunkel bzw. zeigen fremde
Grün-/Blau-/Gelbtöne, die nicht zur Void-Palette passen.

## Erwartet

Alle Farben kommen aus den definierten Tokens in `01-base.css` und folgen
Thema und Akzentfarbe.

## Repro

Voraussetzung: Hub läuft, PWA geöffnet, Einstellungen → Darstellung → Thema „hell“.

1. Session mit Diff öffnen (Diff-Review-Karte).
2. Dateien-Schublade öffnen (`files-sidebar`), Epic-Punkte ansehen.
3. Neue Session → Arbeitsort-Auswahl (`workplace-choice`).

**Ergebnis nach Schritt 1–3:** Rahmen `#2a2f3a`, Hintergrund `#151515`,
Status-Punkte `#9ece6a`/`#7aa2f7`/`#e0af68` — unabhängig vom Thema.

**Häufigkeit:** immer

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | lokal (`127.0.0.1:7373`) |
| Commit | `08c492a0` |
| Node-Version | 24 |
| Adapter | beliebig |
| Repro-Weg | PWA |

## Logs

Keine Laufzeitlogs; statischer Befund:

```text
$ grep -nE 'var\(--(border|bad|bg-card|panel|bg-panel|danger|mono)[,)]' apps/pwa/src/app/styles/*.css | wc -l
32
Tokens --border --bad --bg-card --panel --bg-panel --danger --mono sind nirgends definiert.
```

## Tests

| Ring | Befehl / Datei | Stand vor dem Fix |
|---|---|---|
| Unit | `apps/pwa/test/tokens.test.ts` — Erweiterung: jedes `var(--x` in `app/styles/*.css` muss in `01-base.css` oder `appearance.ts`/`ui-scale.ts` definiert sein | nicht vorhanden |
| Contract (`adapter-testkit`) | — | — |

Der erweiterte Token-Test müsste ohne Fix mit 7 unbekannten Tokens rot sein.

## Eingrenzung

`apps/pwa/src/app/styles/11-report-and-diff.css:337–465`,
`30-files.css:6,40–42,102`, `29-workplace.css:1–12`. Vermutlich aus einem
Prototyp mit anderer Palette übernommen.

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [ ] GitHub-Issue angelegt (`gh issue create`, URL in `forge:`)
- [ ] `bugfix` — eingeplant als T63.1 in [EPIC-P63](../epics/EPIC-P63-ui-konsolidierung.md)
