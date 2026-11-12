---
id: BUG-0124
slug: suche-indexierung-qmd-schlaegt-fehl
status: open
severity: S2
area: server
instance: lokal
commit: "e5b6b90"
forge: ""
epic: ""
created: 2026-11-12
reporter: "Session c0e0ab44 (BUG-0123-Gate-Lauf)"
---

# BUG-0124 — Such-Indexierung schlägt fehl: qmd-Abfrage endet 500 statt 200

## Gesehen

Vollsuite `npm test` auf main (Checkout wie Worktree, reproduzierbar ohne
fremden Diff): 4 Such-Tests rot.

- `apps/hub/test/server.test.ts` „a search on a never-indexed project starts
  real indexing (202) and later serves real results (200)" — Indexierung
  liefert 202, die Folgeabfrage **500 statt 200**.
- `apps/hub/test/modules/search/search.test.ts`: „indexes a small real project
  and finds the right file by real hybrid search", „excludeRelDirs drops
  worktree-duplicate hits", „a search still succeeds with every proxy env var
  pointed at a dead port".

Test-Output nennt `Error: Command failed: qmd query lex: …` (z. B.
`qmd query lex: pineapple cipher deploy guide`).

## Erwartet

Indexierung (202) → Abfrage liefert echte Ergebnisse (200); Hybridsuche,
Worktree-Dedup und Proxy-Fall grün.

## Repro

1. `npm test` (oder gezielt `npx vitest run apps/hub/test/server.test.ts -t "never-indexed"`).
2. Beobachten: 202 auf Indexierung, 500 auf die erste Ergebnisanfrage.

**Häufigkeit:** immer (2026-11-12, zwei Checkouts).

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | lokal |
| Commit | `e5b6b90` (main) |
| Node-Version | 26.7.0 |
| Adapter | — |
| Repro-Weg | vitest |

## Logs

```text
AssertionError: expected 500 to be 200  (server.test.ts:1151)
Error: Command failed: qmd query lex: pineapple cipher deploy guide
```

## Tests

| Ring | Befehl / Datei | Stand vor dem Fix |
|---|---|---|
| Unit | `apps/hub/test/server.test.ts`, `apps/hub/test/modules/search/search.test.ts` | rot (diese Datei) |

## Eingrenzung

`qmd`-Aufruf in der Such-Pipeline schlägt fehl (Rückgabe/Lexikon?); offen.
Nicht Teil von BUG-0123 — dort ohne eigenen Diff ebenso rot (Basisvergleich
per `git stash` belegt).

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [ ] GitLab-Issue angelegt (Link oben)
- [ ] offen (eigener bugfix)
