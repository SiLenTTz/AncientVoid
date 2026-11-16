# PROGRESS — AncientVoid

Stand: 2026-11-16, nach dem Umzug auf GitHub (`SiLenTTz/AncientVoid`).

## Ziel

Neue Session muss in Ordnern funktionieren, die noch nicht existieren, die kein
Git enthalten, und ohne dass der gemerkte Pfad verloren geht. Zusätzlich: die
Entwicklungs-Schleife von 18 Minuten auf unter eine Minute bringen.

## Erledigt (verifiziert)

- **BUG-0171** Session-Start in noch fehlendem Ordner: `ensureProjectDir()` legt
  genau eine Blatt-Ebene innerhalb der `projectRoots` an; fehlt der Elternordner
  oder das Laufwerk, nennt die 422 den konkreten Grund. `workplacePreview()`
  unterscheidet „Ordner existiert noch nicht“ von „nicht lesbar“.
  Live: `POST /api/sessions` → 201, Ordner auf Disk.
- **BUG-0172** Ordner ohne `.git` sind wählbar: `discoverProjects()` listet jede
  unmittelbare Untermappe mit `isGit`, Git-Repos zuerst, Cap 200 mit sichtbarer
  Warnung; `/api/projects` liefert zusätzlich `rootsConfigured`/`roots`.
- **BUG-0173** Gemerkter Pfad wird unabhängig von der Git-Discovery vorgelegt;
  „+ Anlegen“ hängt an `rootsConfigured`, nicht an der Zahl gefundener Repos;
  Discovery-Warnungen sind sichtbar.
- **BUG-0174** Zwei Sessions im selben Ordner ohne Git, nach ausdrücklicher
  Bestätigung (`confirmSharedFolder`, UI-Haken mit Überschreibwarnung). Git bleibt
  Allein-Schreiber. Mit-Nutzer in `checkout_tenants` (Migration **34**, K7:
  überlebt Neustart), Vorschau liefert `holders[]`. ADR-0081.
  Tests: `workplace-mode.test.ts` 13 grün.
- **BUG-0175** Windows-Wurzelvergleich: `platform/paths.ts` mit `pathWithin()` und
  `nearestExistingAncestor()` ersetzt den `/`-String-Vergleich, der Windows-Pfade
  komplett wegfilterte. `paths.test.ts` 5 grün.
- **BUG-0169** E2E-Global-Setup: `npm` wird auf Windows mit `shell: true`
  aufgerufen (`execFileSync("npm", …)` lieferte `ENOENT`, `npm.cmd` → `EINVAL`).
  Ohne diesen Fix läuft auf Windows kein einziger E2E-Test.
- **Test-Tiers** (Messlauf: 959 s Testdauern, 84 % in sechs Dateien): Tier A
  `vitest.config.ts` (parallel) in **18,6 s** statt 1077 s; Tier B
  `VITEST_SET=slow` (Nightly-Suite, Liste `scripts/slow-tests.json`, Generator
  `scripts/gen-slow-tests.mjs`) — abgelöst durch die CI-Restrukturierung auf main.
  `ci.yml` fahren beide Tieres (eigene junit-Dateien). Fehllisten per
  json-Reporter verglichen: verlustfrei; ein Windows-Teardown-Flackern
  (`ENOTEMPTY`) behoben.
- Fernzugriff/Remote: `origin` zeigt auf GitHub, `gitlab` bleibt als Sicherung
  erhalten. Der alte GitLab-Zweig inkl. aller 18 Commits liegt auf GitHub als
  `archiv/gitlab-neue-session-lokal-ohne-git` und lokal als
  `data/backup/2026-11-16_gitlab-branch-18-commits.bundle`.

## In Arbeit

- PR für diesen Zweig (`gh/fix-neue-session-lokal-ohne-git`) ist noch nicht
  eröffnet; Gates laufen gerade erneut auf GitHub-Basis.

## Bekannte Probleme

- **BUG-0170 (offen):** die Suite ist auf Windows breit rot (CRLF, Symlink-`EPERM`
  ohne Entwicklermodus, Spawn/Signale, verwaiste Fake-Services — gemessen 66
  Prozesse nach einem Lauf, Rezept im Bug-Dokument). Deshalb tragen Commits hier
  `!` statt `^`. Größter Hebel: sichtbarer Skip statt Timeout in
  `packages/adapters/{acp,codex,cursor}`, wenn das Harness-CLI fehlt
  (analog tmux/ADR-0002) — nimmt ~660 s aus Tier B.
- Der Produktiv-Hub auf `127.0.0.1:7373` läuft weiter im alten Code; die Fixes und
  Migration 34 greifen erst nach einem Neustart (unterbricht laufende Sessions).
  `projectRoots` in `hub.config.json` ist weiterhin `[]` und soll nach dem
  Neustart auf `E:/Coding` gesetzt werden.
- Nummern-Kollisionen sind in diesem Repo wiederholt passiert (dieselbe Nummer für
  anderes, weil Zweige parallel laufen). Beim Anlegen einer Bug-Nummer deshalb
  immer zuerst `bugs/README.md` auf dem aktuellen `main` prüfen.

## Nächste Schritte

1. Gates auf GitHub-Basis fertig fahren (`typecheck`, `lint`, `check:context`,
   Tier A, `test:e2e` für Workspace-Specs), dann PR mit `gh pr create`.
2. Nach Merge: Hub neu starten, PWA bauen, `projectRoots` setzen.
3. BUG-0170 als eigene Aufgabe (siehe Hebel oben), danach sind `^`-Commits möglich.
4. Old GitLab-CI-Dateien sind auf GitHub entfernt; Doku-Stellen, die noch
   „Pipeline/MR“ sagen, auf Actions/PR umziehen (`docs/ci-runbook.md`).

## Entscheidungen

- **Nicht-Git-Ordner sind legitime Arbeitsorte** (kein Umweg über `git init`).
  Paralleles Schreiben dort ist erlaubt, aber nur nach ausdrücklicher Bestätigung —
  ADR-0081, Tabelle `checkout_tenants` als K7-Wahrheit.
- **Tier A ist der Standard-Loop**, aber nichts fällt aus dem Gate: beide Tieres
  laufen in `gate` und in `ci.yml`.
- **Nummern dieser Kette: BUG-0169–0175, ADR-0081, Migration 34.** Auf GitHub
  waren 0161–0168 bereits durch andere Themen belegt; die Upstream-Verweise
  blieben unangetastet, verschoben wurden nur eigene Belege.
