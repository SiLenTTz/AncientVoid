# PROGRESS — Alte Branch `fix/neue-session-lokal-ohne-git`

## Ziel

Sessions lokal ohne Git/Worktree sauber starten: mehrere Sessions in einem
vorhandenen Ordner, neuer Ordner darf beim Start entstehen, Projekt-Wurzeln auf
Windows funktionieren. Repro, Bug-Dokumente, Fixes auf diesem Zweig.

## Erledigt (verifiziert)

- **BUG-0172** `195eec2a` — `pathWithin(pathStyle)` in
  `packages/core/src/platform/paths.ts`; `outsideRoots()` vergleicht
  Windows-/POSIX-Pfade richtig. `paths.test.ts` 5 grün; altes Verhalten war
  nachgerechnet `true` für `E:\Coding\projekt` unter `E:\Coding`.
- **BUG-0168** `1fcf8a45` + `e21ba1f3` — `ensureProjectDir` legt die fehlende
  Blatt-Ebene an (eine Ebene, kein Baum; `/coding` wird abgewiesen, weil es auf
  Windows laufwerksrelativ nach `E:\coding` ginge), `workplacePreview` meldet den
  fehlenden Ordner ehrlich. Live: `POST /api/sessions` → 201, Ordner auf der
  Festplatte; UI-Flow in `gitrepo\unterordner` → Session `ad23bb4c` + Ordner.
- **BUG-0169** `525e9660` — Discovery listet Ordner ohne `.git` (`isGit`),
  Git-Repos zuerst, Cap 200 mit Warnung. Live: Dropdown zeigte `plain-ordner`,
  Session `19bf1be1` direkt darin.
- **BUG-0170** `e21ba1f3` — `/api/projects` liefert `rootsConfigured`/`roots`;
  gemerkter Pfad wird immer vorgelegt, „+ Anlegen“ hängt an den Wurzeln,
  Hinweis trennt „Wurzeln fehlen“ von „Wurzeln ohne Repos“, Discovery-Warnungen
  sichtbar. Live: gemerkter `<root>\gitrepo\unterordner` nach Reload vorgelegt,
  obwohl nicht in der Discovery.
- **BUG-0171** `61b0198e` + [ADR-0081](docs/adr/0081-paralleles-schreiben-in-ordnern-ohne-git.md) —
  Git bleibt Allein-Schreiber; Ordner ohne `.git` bekommen nach
  `confirmSharedFolder` eine Mit-Nutzerschaft (`checkout_tenants`, Migration 34),
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
- **Tests entzerrt (Messung statt Bauchgefühl):** ein json-Reporter-Lauf über
  die ganze Suite ergab 959 s Testdauern, davon 84 % in sechs Dateien
  (acp-Adapter 465 s, codex app-server 180 s, k8-Lasttest 89 s,
  device-service 38 s, ws-history 18 s, acp contract 15 s). Neu: Tier A
  (`vitest.config.ts`, parallel) und Tier B (`vitest.slow.config.ts`, seriell,
  Liste mit gemessenen Dauern in `scripts/test-tiers.ts`). `npm test` läuft in
  **18,6 s** statt 1077 s; `npm run test:slow` fährt den Rest, `gate` und CI
  fahren beide (eigene junit-Dateien). Diff der Fehllisten über json-Reporter:
  keine neuen Fehlschläge durch Parallelität, ein Windows-Teardown-Flackern
  (`ENOTEMPTY` in `diagnostics.routes.test.ts`) dabei behoben. Tier B gemessen:
  **1535 s (11 Dateien, 61 failed / 123 passed)** — zusammen mit Tier A (150 bis
  153) dieselbe Fehlerpopulation wie im Gesamtlauf (211–214), die Aufteilung ist
  also verlustfrei.
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
- **Prozesslecks aus fehlgeschlagenen Windows-Tests:** nach solchen Läufen
  standen 66 Fake-Services (`createServer … ANCIENTVOID_WORKSPACE_PORT`,
  `node svc.js`) als `node`-Prozesse herum und belegen Ports. Rezept zum
  Aufräumen steht in BUG-0167; dauerhaft gehören die Aufräumpfade in die Tests.
  Nach dem Aufräumen: genau zwei `node`-Prozesse (Kais Hub 22668, Pi 23196),
  `/healthz` → 200.
- **Git-Zugang geheilt, aber weit auseinander:** `origin` auf HTTPS umgestellt
  (`https://gitlab.com/SiLenT_Tz/AncientVoid.git`), `glab` angemeldet als
  `kaifelixbennett` (OS-Keyring). Fetch: **104 neue Commits auf `main`**
  (`3aef99e5` → `95c1c1ea`), dieser Zweig 15 voraus, 104 zurück.
- **Kollisionen durch Parallelarbeit auf `main` — aufgelöst:** Upstream belegte
  dieselben Nummern für anderes: `bugs/bug-0161…0165` (Tool-Aktivität,
  Exit-Regex, CI rot, Offline-Diff, Restart-Working), `docs/adr/0077-
  run-nach-team-umbenennung.md`, `db.ts` `id: 33 session-auto-resume-on-limit`.
  Unsere Kette heißt jetzt **BUG-0168–0172** (0166/0167 waren frei und bleiben
  uns), unser ADR ist **0081**, unsere Migration ist **34**. Nachgezogen in Code-
  Kommentaren, Tests, E2E-Spec, Bug-Dokumenten und Verweisen — die Upstream-
  Nummern blieben unangetastet (sie stehen in anderen Dateien). Gemerged wurde
  `origin/main` **in den Feature-Zweig** — kein lokales Merge nach `main`.
- Der Produktiv-Hub auf `127.0.0.1:7373` läuft weiter im alten Code; die Fixes
  wirken erst nach einem Neustart (unterbricht laufende Sessions). Danach kann
  `projectRoots` in `hub.config.json` wieder befüllt werden (Workaround
  „leer lassen“ ist dank BUG-0172 nicht mehr nötig), und `hub.db` braucht die
  Migration 33 (beim Start automatisch).

## Nächste Schritte

1. **Merge von !485 zieht sich:** MR ist angelegt und steht auf „mergeable“
   (https://gitlab.com/SiLenT_Tz/AncientVoid/-/merge_requests/485), Branch
   gepusht. Der angemeldete Account `kaifelixbennett` ist im Projekt nur
   **Developer (Zugriffsebene 30)** — Merge braucht Maintainer/Owner
   (`SiLenT_Tz`, Ebene 50). Also: Merge in der GitLab-UI durch `SiLenT_Tz`
   oder `glab` mit dem Owner-Account einloggen. Danach Source-Branch löschen
   (`git fetch --prune`). Kein lokales Merge nach `main` (Repo-Regel).
2. Nach Merge: Hub neu starten, PWA bauen, `projectRoots` wieder setzen.
3. CI-Pipeline zu !485 (#1630) wurde sofort `failed` (`started_at` null) — das
   ist der bestehende Zustand aus BUG-0163 („verify seit 11.11 rot“), nicht die
   neue CI-Zeile für Tier B. Nachziehen laut `docs/ci-runbook.md`, wenn der
   Runner `av-docker` wieder annimmt.
4. BUG-0167 als eigene Suite-Hausputz-Aufgabe: `.gitattributes` `eol=lf` für
   Fixtures, Symlink-Skips, Prozess-Teardowns, und **sichtbarer Skip statt
   Timeout** in `packages/adapters/{acp,codex,cursor}` wenn das Harness-CLI
   fehlt (analog tmux/ADR-0002) — das allein nimmt ~660 s aus Tier B.

## Entscheidungen

- ADR-0077: Allein-Schreiber bleibt für Git-Checkouts; Ordnern ohne `.git` wird
  paralleles Schreiben nach ausdrücklicher Bestätigung erlaubt, Mit-Nutzerschaft
  in SQLite (K7) statt im Speicher.
- `ensureProjectDir` legt genau eine Ebene an und lehnt laufwerksrelative Pfade
  ab — lieber eine ehrliche Fehlermeldung als ein still angelegter Ordnerbaum.
- Discovery ohne `.git` ist erwünscht (lokales Arbeiten ohne Git ist kein
  Umweg über `git init`), aber mit Cap und Warnung statt ungezogener Liste.
