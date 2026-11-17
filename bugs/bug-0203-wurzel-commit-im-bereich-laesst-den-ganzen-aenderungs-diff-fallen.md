---
id: BUG-0203
slug: wurzel-commit-im-bereich-laesst-den-ganzen-aenderungs-diff-fallen
status: done
severity: S2
area: hub
instance: pc
commit: "fix/0202-wurzel-commit-laesst-den-ganzen-diff-fallen"
forge: ""
epic: ""
---

# Ein Eltern-lose Commit im Bereich lässt den ganzen Änderungsdiff fallen

## Symptom (live gemessen, 17.11.2026)

In der eigenen Session (`18830ec6-…`, Zweig `lokal/live-integration`) zeigt der Reiter
**Änderungen** keine Dateien, keine Commits, keine Hunks. Leerer Zustand mit Fehler:

```
git diff fehlgeschlagen: Command failed: git -C …\data\worktrees/18830ec6-… diff
--numstat 4bfbcc2d7915b53ca2235f2007336780f314159f^ 4bfbcc2d7915b53ca2235f2007336780f314159f
fatal
```

Gemessene Zähler im Browser: `dateien 0 · commitzweige 0 · hunks 0 · zeilen 0`. Die Session
hat an dem Tag 20+ PRs gemerged — der Reiter war also komplett nutzlos.

## Ursache (gemessen, nicht vermutet)

```
git -C <worktree> cat-file -t 4bfbcc2d…   -> commit
git -C <worktree> log -1 --format="%H %P" -> 4bfbcc2d…        (keine Eltern)
```

`4bfbcc2d` ist ein **Wurzel-Commit** (Eltern-los). `apps/hub/src/modules/sessions/diff.ts`
baut den Per-Commit-Diff blind als `sha^..sha`; für einen Wurzel-Commit existiert `sha^`
nicht, git antwortet `fatal: ambiguous argument … unknown revision`, und der Aufrufer fängt
die Ausnahme als Fehler des **gesamten** Diffs. Ein einziger Wurzel-Commit im Bereich
`baseRef..HEAD` genügt — der Fall tritt auf, wenn die Basis nicht Vorfahr des Zweiges ist
(hier: gemischte Geschichten aus der GitLab-/GitHub-Umstellung).

## Erwartung / Ist

Erwartet: der Wurzel-Commit wird gegen den **leeren Baum** gediffelt, die Ansicht zeigt seine
Dateien. Ist: gar kein Diff, nur eine abgeschnittene `fatal`-Meldung.

## Behoben

`parentOrEmptyTree(projectPath, sha)` in `diff.ts`: Eltern-Revision per
`rev-parse --verify --quiet sha^` prüfen, sonst Git's leerer Baum
(`4b825dc642cb6eb9a060e54bf8d69288fbee4904`). Genutzt an beiden Stellen: Per-Commit-Diff
(`commitFiles`) und Einzel-Datei-Hunks (`getSessionFileHunks`).

## Rot-dann-grün

Neuer Fall in `apps/hub/test/modules/sessions/diff.test.ts` (Orphan-Zweig: sein erster
Commit hat keine Eltern, liegt aber im Bereich `base..HEAD`):
vorher `1 failed | 13 passed` mit exakt der Live-Meldung
`git diff fehlgeschlagen: … 927e29cd…^ …`, nachher **14 passed** (3,4 s).
`npm run typecheck` Exit 0.

## Wirkung am Gerät

Der Reiter „Änderungen“ brauchte danach einen Hub-Neustart (Server-Code). Nachweis: Zähler im
Browser auf dieser Session — `hunks > 0`, `commitzweige > 0`.

## Nummer

Vorherige: BUG-0202 (`cursor.unhandled`-Frage im Chat — schon auf main; die Nummerkollision
entstand durch parallele Arbeit, deshalb trägt dieser Fall hier die 0203). Nächste freie
Nummer: **0204**.
