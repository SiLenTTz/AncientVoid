---
id: BUG-0189
slug: bugs-ohne-statusfarben-im-dateibaum
status: open
severity: S4
area: pwa
instance: dev
commit: "f5fbed08"
forge: "https://github.com/SiLenTTz/AncientVoid/issues/72"
epic: ""
created: 2026-11-17
reporter: "Nutzerbeobachtung Dateibaum"
---

# BUG-0189 — `bug-*.md` im Dateibaum ohne Statusfarben (Epics haben Punkte)

## Gesehen

Im Dateibaum tragen `EPIC-*.md` einen farbigen Statuspunkt (grün / gelb /
blau / grau). `bug-*.md` daneben bleiben ohne Punkt — Status aus dem
Frontmatter ist im Baum unsichtbar.

## Erwartet

Bugs bekommen **dieselben** Punkt-Tokens wie Epics
(`.epic-dot.epic-done|epic-code|epic-wip|epic-open` /
`--ok` / `--warn` / `--info` / `--fg-faint`). Mapping aus dem Bug-Frontmatter
`status`:

| `status` | Punkt (wie Epic) |
|---|---|
| `done` | grün (`epic-done`) |
| `in-progress` / `in Arbeit` | gelb oder blau — **gleiche Klasse wie laufende Epics** (`epic-wip` bzw. `epic-code`, nicht neue Farbe) |
| `open` | grau (`epic-open`) |
| `wont-fix` | grau (`epic-open`) mit Tooltip „won't fix“ |

Hinweis: Die Epic-Palette hat **kein Rot** (Nutzererinnerung „rot“ = eher
`epic-wip`/`--info` blau). Keine neue Farbe erfinden — Parität zu Epics.

## Repro

Voraussetzung: Hub mit Projekt, das `epics/` und `bugs/` enthält (z. B. dieses Repo).

1. Session auf dem Projekt öffnen.
2. Dateibaum → Ordner `epics/` → Statuspunkte an `EPIC-*.md` sichtbar
   (Beleg: `e2e/specs/dateibaum-epic-status.spec.ts`).
3. Ordner `bugs/` öffnen.

**Ergebnis nach Schritt 3:** `bug-*.md` ohne `.epic-dot` / ohne
Statusfarbe; Frontmatter `status:` wird nicht gelesen
(`annotateEpics` filtert nur `EPIC_FILE` in
`packages/core/src/modules/code/explorer.ts`).

**Häufigkeit:** immer

**Repro-Weg:** code-bestätigt (Explorer annotiert nur `EPIC-*.md`); PWA-Klick
entspricht dem bestehenden Epic-E2E-Pfad.

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | lokal |
| Commit | `f5fbed08` |
| Node-Version | v26.7.0 |
| Adapter | — |
| Repro-Weg | Code + Nutzerbeobachtung PWA |

## Logs

Kein Server-Fehler — fehlende Annotation, kein Event.

```text
EPIC_FILE = /^EPIC-[A-Za-z]?[0-9.]+.*\.md$/i
# bug-NNNN-*.md matcht nicht → epic/epicStatus bleiben null
```

## Tests

| Ring | Befehl / Datei | Stand vor dem Fix |
|---|---|---|
| Unit | `packages/core/test/modules/code/explorer-epic.test.ts` (Bug-Analogon) | nicht vorhanden |
| E2E | Erweiterung von `e2e/specs/dateibaum-epic-status.spec.ts` oder eigene Spec | nicht vorhanden |

Ohne Fix bleibt nur der Epic-Pfad grün; Bug-Dateien haben keinen
Statuspunkt-Assert.

## Eingrenzung

- `packages/core/src/modules/code/explorer.ts` — `annotateEpics` / neues
  `annotateBugs` aus Frontmatter `status:`
- `packages/contracts/src/code/explorer.ts` — ggf. Feld wiederverwenden
  (`epic`/`epicStatus`) oder explizites `bugStatus`
- `apps/pwa/src/features/files/FilesSidebar.tsx` + `apps/pwa/src/app/styles/30-files.css`

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [x] GitHub-Issue angelegt (`forge:`)
- [ ] offen — `bugfix` wenn gewünscht
