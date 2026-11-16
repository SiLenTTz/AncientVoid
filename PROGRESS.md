# PROGRESS — Alte Branch `fix/neue-session-lokal-ohne-git`

## Ziel

Sessions lokal ohne Git/Worktree sauber starten: mehrere Sessions in einem
vorhandenen Ordner, neuer Ordner darf beim Start entstehen, Projekt-Wurzeln auf
Windows funktionieren. Repro, Bug-Dokumente, Fixes auf diesem Zweig.

## Erledigt (verifiziert)

- **BUG-0165** `195eec2a` — `pathWithin(pathStyle)` in
  `packages/core/src/platform/paths.ts`; `outsideRoots()` vergleicht
  Windows-/POSIX-Pfade richtig. `paths.test.ts` 5 grün; altes Verhalten war
  nachgerechnet `true` für `E:\Coding\projekt` unter `E:\Coding`.
- **BUG-0161** `1fcf8a45` + `e21ba1f3` — `ensureProjectDir` legt die fehlende
  Blatt-Ebene an (eine Ebene, kein Baum; `/coding` wird abgewiesen, weil es auf
  Windows laufwerksrelativ nach `E:\coding` ginge), `workplacePreview` meldet den
  fehlenden Ordner ehrlich. Live: `POST /api/sessions` → 201, Ordner auf der
  Festplatte; UI-Flow in `gitrepo\unterordner` → Session `ad23bb4c` + Ordner.
- **BUG-0162** `525e9660` — Discovery listet Ordner ohne `.git` (`isGit`),
  Git-Repos zuerst, Cap 200 mit Warnung. Live: Dropdown zeigte `plain-ordner`,
  Session `19bf1be1` direkt darin.
- **BUG-0163** `e21ba1f3` — `/api/projects` liefert `rootsConfigured`/`roots`;
  gemerkter Pfad wird immer vorgelegt, „+ Anlegen“ hängt an den Wurzeln,
  Hinweis trennt „Wurzeln fehlen“ von „Wurzeln ohne Repos“, Discovery-Warnungen
  sichtbar. Live: gemerkter `<root>\gitrepo\unterordner` nach Reload vorgelegt,
  obwohl nicht in der Discovery.
- **BUG-0164** `61b0198e` + [ADR-0077](docs/adr/0077-paralleles-schreiben-in-ordnern-ohne-git.md) —
  Git bleibt Allein-Schreiber; Ordner ohne `.git` bekommen nach
  `confirmSharedFolder` eine Mit-Nutzerschaft (`checkout_tenants`, Migration 33),
  `holders[]` in der Vorschau, Resume/`stop`/`archive` behandelt sie korrekt.
  `workplace-mode.test.ts` 13 grün (3 neue Fälle). Live: zwei direkte Sessions
  (5bb46b05, 6cb0b175) in `plain-ordner`, Warnung + Haken im Screenshot,
  `checkout_tenants` genau eine Zeile. Nebenbefund behoben: deaktivierter
  „Starten“-Knopf hatte keine Deaktiviert-Optik.
- **BUG-0166** `c1d7552f` — `e2e/support/global-setup.ts` spawnnt `npm` auf
  Windows mit `shell` (vorher `ENOENT`, mit `npm.cmd` `EINVAL`): das E2E-Gate war
  auf Windows nicht ausführbar. Zusätzlich
  `npx playwright install chromium` (118 MB) nachgeholt.
  **E2E: `e2e/specs/session-workspace-mode.spec.ts` 5 passed (10,7 s)** inkl.
  neuem Fall für Ordner ohne Git / Bestätigung / dritte Session.
- Hausputz: `npm run docs:reference` → `check:context` OK (`88364357`);
  `node_modules/@ancientvoid/*`-Junctions auf die kanonische Großschreibung
  gesetzt (vorher liefen Vitest-Setups nicht).

## In Arbeit

Nichts angefangen, das nicht committet wäre. Offen: Push und MR (siehe unten).

## Bekannte Probleme

- **BUG-0167 (offen, S2, tests):** `npm test` ist auf diesem Windows-Rechner
  breit rot — 212 failed / 1854 passed. Klassen: Git-CRLF (`'hello\r\n'`),
  Symlink-EPERM ohne Entwicklermodus, Prozess-/Signal-/Port-Gruppe,
  approval/budget im Hub-Server-Test („session not live“). Im angegriffenen
  Teilbereich core workspace+sessions: main 22 failed → hier 21 failed
  (keine neuen, einer weniger). Deshalb tragen die productcommits `!` statt `^`.
- **Git-Fernzugriff kaputt:** `git fetch origin` →
  `git@gitlab.com: Permission denied (publickey)`, `glab` ist nicht installiert.
  Damit ist „neuesten Stand von `main` reinziehen“ nur gegen den letzten
  bekannten Stand möglich: `origin/main` = `3aef99e5`, dieser Zweig ist 9 Commits
  voraus und 0 zurück. Push/MR sind blockiert, bis der Schlüssel wieder bei
  GitLab hinterlegt ist (oder `glab`/Token eingerichtet wird).
- Der Produktiv-Hub auf `127.0.0.1:7373` läuft weiter im alten Code; die Fixes
  wirken erst nach einem Neustart (unterbricht laufende Sessions). Danach kann
  `projectRoots` in `hub.config.json` wieder befüllt werden (Workaround
  „leer lassen“ ist dank BUG-0165 nicht mehr nötig), und `hub.db` braucht die
  Migration 33 (beim Start automatisch).

## Nächste Schritte

1. Git-Zugang klären (Schlüssel bei GitLab oder `glab` einrichten), dann
   `git fetch` + `git rebase origin/main`, `git push -u`, MR via `glab`.
2. Nach Merge: Hub neu starten, PWA bauen, `projectRoots` wieder setzen.
3. BUG-0167 als eigene Suite-Hausputz-Aufgabe (`e`-Commit-Kette:
   `.gitattributes` `eol=lf` für Fixtures, Symlink-Skips, Plattform-Baseline im
   Gate).

## Entscheidungen

- ADR-0077: Allein-Schreiber bleibt für Git-Checkouts; Ordnern ohne `.git` wird
  paralleles Schreiben nach ausdrücklicher Bestätigung erlaubt, Mit-Nutzerschaft
  in SQLite (K7) statt im Speicher.
- `ensureProjectDir` legt genau eine Ebene an und lehnt laufwerksrelative Pfade
  ab — lieber eine ehrliche Fehlermeldung als ein still angelegter Ordnerbaum.
- Discovery ohne `.git` ist erwünscht (lokales Arbeiten ohne Git ist kein
  Umweg über `git init`), aber mit Cap und Warnung statt ungezogener Liste.
