---
id: BUG-0167
slug: testsuite-auf-windows-rot
status: open
severity: S2
area: tests
instance: dev
commit: "88364357"
forge: ""
epic: ""
created: 2026-11-16
reporter: Pi-Session 2026-11-16 (Gate für BUG-0161 bis 0164 sollte gefahren werden)
---

## Gesehen

`npm test` auf diesem Windows-Rechner (Arbeitszweig, Hausputz der generierten
Referenzen already done, `check:context` OK):

```
Test Files  62 failed | 220 passed | 2 skipped (284)
     Tests  212 failed | 1854 passed | 56 skipped (2122)
```

Vergleich auf dem Teilbereich, der diese Änderung angeht
(`packages/core/test/modules/{workspace,sessions}`): `main` 22 failed /
215 passed / 3 skipped — mit den Fixes 21 failed / 219 passed / 3 skipped. Es
kamen also keine Fehlschläge dazu, einer weniger. Der Arbeitszweig war zu dem
Zeitpunkt bereits committet, ein separater Baseline-Lauf mit gestashetem
Arbeitsstand war für die Drei-Datei-Stichprobe nicht möglich; die genannten
Ursachen (CRLF, Symlinks, Spawn/Signale) hängen an keiner geänderten Datei.

## Erwartet

`npm run gate` (typecheck, lint, test, test:e2e) ist auf der
Entwicklungsumgebung ausführbar und grün, oder die Plattform-Grenzen sind
dokumentiert und die betroffenen Tests überspringen sichtbar (wie bei tmux und
Playwright-Browsern üblich).

## Repro und Logs

1. Repo auf Windows, `npm ci`.
2. `npm test`.
3. Ausgewählte Ursachen, einzeln nachgewiesen:
   - `worktree.test.ts`: `AssertionError: expected 'hello\r\n' to be 'hello\n'` —
     Git checkt mit CRLF aus (`core.autocrlf`), Tests erwarten LF. Ebenso
     `worktree-apply.test.ts` („aborts a conflicting merge and names the file“).
   - `include-copy.test.ts`, `vault.test.ts` (8 Fälle), Teile von
     `workspace/projects.test.ts`: `Error: EPERM: operation not permitted,
     symlink …` — Windows erlaubt ohne Entwicklermodus keine Symlinks.
   - `workspace-services.test.ts` (5), `session-workspace.test.ts` (2),
     `archive-workspace.test.ts` (2), `recovery-parallel.test.ts` (3):
     Spawn/Signal-/Port-Gruppe (POSIX-Signale, Prozessgruppen).
   - `apps/hub/test/server.test.ts` (5, approval/budget): „session not live“.

## Eingrenzung

Nicht die Product-Änderung: identische Fehlschläge bei gestashetem
Arbeitsstand. Es fehlt eine Windows-Baseline: Zeilenenden (`.gitattributes`
mit `* text=auto eol=lf` für Testfixtures), Symlink-abhängige Tests mit
sichtbarem Skip statt harterexpectation, und die Prozess-/Signal-Gruppe mit
platform awareness.

## Fix

offen — Umfang ist Suite-Hausputz über mehrere Dateien, kein Nebenschauplatz
eines Bugfix-Zweigs. Vorbild für den Skip-Stil:
`packages/core/test/modules/workspace/projects.test.ts` (`trySymlink` +
`ctx.skip()`) und `workplace-mode.test.ts` (Symlink-Teil ausgenommen, Rest prüft
weiter).

## Tests

Kein neuer Test; dieser Report dokumentiert die gemessene Zahl und die vier
Ursachenklassen.

## Handoff

Solange BUG-0167 offen ist, tragen Commits, die nur Teilbereiche grün haben,
`!` statt `^` (Commit-Notation). Für ^-Commits braucht es entweder a) die Suite
auf Windows grün, oder b) eine dokumentierte, maschinenlesbare
Plattform-Baseline im Gate.
