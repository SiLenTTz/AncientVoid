---
id: BUG-0014
slug: search-indexes-worktree-duplicates
status: done
severity: S3
area: server
instance: dev
commit: ""
forge: ""
epic: "EPIC-P3 T3.8"
created: 2026-09-18
reporter: "Claude Sonnet 5 (autonomous session, live verification run)"
---

# BUG-0014 — Sprachsuche zeigt Worktree-Kopien als doppelte Treffer

## Gesehen

Beim echten End-to-End-Test von T3.8 (Hub gegen sein eigenes Repo
gestartet — `hub.config.json`s `projectRoots` enthält den Pfad, in dem
auch `dataDir: "./data"` liegt) lieferte eine echte Suche nach
`"adapter contract"` u. a. diese beiden Treffer:

```json
{ "file": "CONTRIBUTING.md", ... }
{ "file": "data/worktrees/c9e6586e-.../CONTRIBUTING.md", ... }
```

Der zweite Treffer ist eine reale Kopie — jeder Git-Worktree (T2.1)
enthält einen vollständigen Checkout, also auch jede echte Markdown-Datei
nochmal. `qmd` (der reale Such-Backend, siehe `search.ts`s Doc-Kommentar)
hat weder ein `--exclude`/`--ignore`-Flag (eigene Skill-Doku durchsucht,
nichts gefunden) noch beachtet es `.gitignore` (`data/` ist gitignored,
`qmd ls` zeigte die Worktree-Dateien trotzdem als indiziert).

## Erwartet

Echte Dateien in `dataDir` (insbesondere Worktree-Kopien) tauchen nicht
als Suchtreffer auf, wenn `dataDir` innerhalb des durchsuchten Projekts
liegt.

## Repro

1. Hub mit `dataDir` innerhalb eines `projectRoots`-Eintrags starten.
2. Mindestens eine Session mit Worktree-Isolation erstellen (T2.1 legt
   `dataDir/worktrees/<id>/` an).
3. `GET /api/search?project=<projectRoot>&q=<Text, der in einer echten
   Markdown-Datei vorkommt>`.
4. Vor dem Fix: die Worktree-Kopie erscheint als eigener, doppelter Treffer.

**Häufigkeit:** immer, deterministisch, sobald mindestens eine
Worktree-isolierte Session existierte, bevor der Erstindex lief.

## Umgebung

| Feld | Wert |
|---|---|
| Repro-Weg | echter Hub, echte PWA, echter `qmd` (kein Mock) |
| Betroffen | `packages/server/src/search.ts`, `GET /api/search` |

## Eingrenzung

`packages/server/src/search.ts`, `searchProject()` — qmd selbst kann die
Duplizierung nicht verhindern (keine Ignore-Fähigkeit real vorhanden),
also muss die Filterung nach der qmd-Anfrage passieren.

## Fix

- `relativeDataDir(projectPath, dataDir)` — reale, `path.relative()`-basierte
  Berechnung (kein String-Präfix-Vergleich, der z. B. `project-data` fälschlich
  träfe), `undefined` wenn `dataDir` nicht wirklich innerhalb liegt.
- `searchProject()` nimmt jetzt `excludeRelDirs` — filtert qmd-Treffer
  danach heraus, fragt qmd von vornherein nach mehr Rohtreffern (`limit *
  4`, mindestens 20), damit nach dem Filtern trotzdem eine volle Seite
  übrig bleibt.
- `routes.ts`s `GET /api/search` übergibt `relativeDataDir(project,
  deps.dataDir)` automatisch.

## Tests

| Ring | Befehl / Datei | Stand vor dem Fix |
|---|---|---|
| Integration (echtes `qmd`) | `packages/server/test/search.test.ts` — "excludeRelDirs drops worktree-duplicate hits that would otherwise appear" | Testet zuerst ungefiltert (Duplikat real vorhanden, beweist den Bug), dann gefiltert (Duplikat weg, echte Datei bleibt) |
| Unit | `packages/server/test/search.test.ts` — 4 neue Tests für `relativeDataDir` (verschachtelt, außerhalb, dataDir==project, Präfix-Verwechslung) | rot ohne die Funktion |

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [ ] GitLab-Issue — wird über die MR verlinkt
- [x] Direkt gefixt auf `fix/search-excludes-hub-datadir`
