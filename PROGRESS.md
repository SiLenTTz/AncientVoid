# PROGRESS — AncientVoid

Stand: 2026-11-17, nach dem Umzug auf GitHub (`securesight-ai/AncientVoid`).

## Ziel

Neue Session muss in Ordnern funktionieren, die noch nicht existieren, die kein
Git enthalten, und ohne dass der gemerkte Pfad verloren geht. Zusätzlich: die
Entwicklungs-Schleife von 18 Minuten auf unter eine Minute bringen.

## Erledigt (verifiziert)
- **Drehen der installierten App: erledigt (BUG-0186 done).** Die Web-Ebene war frei
  (Manifest `any`, kein Manifest-Cache, Worker `ancientvoid-v6`), die Sperre saß in **Chromes
  Installations-Metadaten** — die beim Anlegen übernommene Ausrichtung (`portrait-primary`)
  wird durch eine spätere Manifest-Aenderung nicht ersetzt. Nachweis ueber den
  Geraete-Selbstbericht im Hub-Protokoll: vorher 0° / 874x883 (standalone, `lock()` ->
  SecurityError), nach Entfernen + Neuanlegen **270° / 970x796**. Dauerhaft: Selbstbericht-
  Route `/api/diagnostics/client-report` (PR #111), Hinweiszeile im Stand-Panel (PR #113).
- **Zustellung wählen und Vorgemerktes nachträglich ändern (ADR-0085, Zweig
  `feat/queue-liefern-und-editieren`)**: während ein Zug läuft, sitzt im Composer ein Chip
  `⏳ am Zugende` / `⚡ lenken` (bleibt über Neuladen gleich), der Hauptknopf heißt passend
  „Vormerken“ oder „Jetzt lenken“. Die Wahl existiert nur, wo der Adapter Eingaben mitten im
  Zug zusagt — dafür gibt es die neue Capability `midTurnInput` (Pi: `true`); Claude behält
  die Ablehnung aus ADR-0074 und zeigt die Wahl sichtbar nicht. Vorgemerktes ist danach
  änderbar: Text (✎) und Reihe (↑ nach vorn / ↓ nach hinten) über die neue Spalte `position`
  (Migration 35 `queue-position`) und `PATCH /api/sessions/:id/queue/:queueId`; Events
  `session.queue_edited` / `session.queue_moved`. Bei `delivery: "unknown"` bleiben Text und
  Reihe gesperrt. Belege: `session-queue.test.ts` 20 Fälle (14 vorhandene + 6 neue, 19 grün —
  der K7-Neustart-Fall schlägt auf Windows mit `EBUSY: hub.db` fehl, auf `origin/main`
  identisch, BUG-0170), Hub-Route 13 grün, PWA-Suite 460 grün, E2E `pause-queue.spec.ts` +
  `querformat.spec.ts` 18 grün (`--workers=1`). Mitgeflogen: BUG-0194 — im niedrigen
  Querformat hing das Dock an der Listenspalte (Eingabe unter der Kante), und der
  Warteschlangen-Text war bei 390 px auf ~15 Zeichen gekürzt.

- **BUG-0181 App dreht nicht mit (PR #41, Zweig `fix/orientation-mitdrehen`)**: das Manifest
  stand seit dem ersten öffentlichen Release auf `"orientation": "portrait-primary"` — eine
  installierte PWA dreht sich nicht. Außerdem verlor `08-session-events.css` die Kaskade für
  niedrige Fenster (BUG-0053 faktisch zurück). Neu `50-short-viewport.css` (zuletzt
  importiert). Gemessen bei 915 × 412: Dock 278 → 180 px, Chat 48 → 130 px (Steuerung zu)
  bzw. 160 px (offen); Hochformat 412 × 915 unverändert (Chat 326 px, Laufleiste sichtbar).
  Beleg: `e2e/specs/querformat.spec.ts` 3 neue Fälle grün (Manifest ohne Sperre; Querformat
  mit Dock ≤ 200 / Chat ≥ 90 / Tabs im Screen; hoch → quer → hoch **ohne Reload**). Die drei
  bestehenden Claude-Fälle derselben Datei sind auf Windows nicht prüfbar (BUG-0179,
  `read ECONNRESET`) — mit und ohne Änderung identisch.


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
