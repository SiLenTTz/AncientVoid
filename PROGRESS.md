# PROGRESS — AncientVoid (Arbeitsstand dieser Session)

## Ziel

Lokales Arbeiten ohne Git sauber machen: „Neue Session“ darf nicht jedes Mal
einen neuen Projektpfad erzwingen — mehrere Sessions in einem vorhandenen
Ordner **und** ein Ordner, der noch nicht existiert, müssen beide gehen.

## Erledigt (verifiziert)

- **Branch** `fix/neue-session-lokal-ohne-git` auf `main` @ `3aef99e5`.
- **Repro erzeugt** (Scratch-Hub in `%TEMP%` mit eigenem `data/` und
  `projectRoots`, Adapter `dummy`, PWA per agent-browser; Kais Instanz
  `127.0.0.1:7373` und `data/hub.db` nur **lesend**):
  - nicht existierender Ordner in konfigurierter Wurzel →
    `project path is outside the configured projectRoots`, keine Session,
    kein Ordner (`GET /api/sessions` → `[]`)
  - Projektauswahl zeigt nur `gitrepo (main)`, `plain-ordner` (ohne `.git`) fehlt
  - bei `projectRoots: []`: Pfad-Feld leer trotz
    `ancientvoid.newSession.last`, kein „+ Anlegen“, Hinweis
    „keine Projekt-Wurzeln konfiguriert“
  - zweite Session im selben Ordner → Karte + Formular melden
    „… bereits eine andere AncientVoid-Session (55edb95c) …“, Worktree-Karte
    deaktiviert („Nicht möglich: kein Git-Projekt“) → Sackgasse
  - `data/hub.db`: genau eine Session pro Projekt, `checkout_leases` gehören
    zu Sessions im Status `idle`
- **Bugs angelegt** (`10620124`): BUG-0161 (fehlender Ordner), BUG-0162
  (Ordner ohne `.git` nicht wählbar), BUG-0163 (Pfad/Anlegen/Hinweis hängen an
  `projects.length`), BUG-0164 (mehrere Sessions pro Ordner), BUG-0165
  (`outsideRoots()` mit `/`-Vergleich → Windows). Index `bugs/README.md`
  nachgezogen, nächste freie Nummer 0166.

- **BUG-0165 gefixt und verifiziert** (`195eec2a`): neu
  `packages/core/src/platform/paths.ts` (`pathWithin(pathStyle)`,
  `nearestExistingAncestor`), `outsideRoots()` nutzt es. Beleg: altes
  Verhalten live nachgerechnet (`outside("E:\\Coding\\projekt",["E:\\Coding"])`
  → `true`, falsch), neue Tests `packages/core/test/platform/paths.test.ts`
  5 grün.
- **BUG-0161 gefixt und API-seitig verifiziert** (`1fcf8a45`):
  `isProjectPathAllowed` löst jetzt den nächsten existierenden Eltern auf,
  `ensureProjectDir` legt genau eine Ebene an (und lehnt laufwerksrelative
  Pfade wie `/coding` ab), `workplacePreview` meldet den fehlenden Ordner
  ehrlich. Beleg im Browser-/API-Repro auf dem Scratch-Hub (Port 59020):
  `POST /api/sessions` auf `<projRoot>\kinderglueck` (Ordner fehlte) →
  **201**, Ordner `kinderglueck` danach auf der Festplatte; Preview für drei
  fehlende Blätter → „Ordner existiert noch nicht … wird beim Start
  angelegt“, für drei existierende → 200. Falsche Meldung
  „outside the configured projectRoots“ ist damit weg.
- Tests: `projects.test.ts` 14 (2 Symlink-Fälle auf Windows ohne
  Entwicklermodus übersprungen — EPERM, war vorher schon so),
  `paths.test.ts` 5; `npm run typecheck` und `npx eslint` (betroffene Dateien)
  grün.
- Nebenbefund behoben: `node_modules/@ancientvoid/*`-Junctions zeigten auf
  `E:\coding\...`, vitest-Global-Setup erwartet `E:\Coding\...` → 25 Junctions
  auf die kanonische Form gesetzt (`check:workspace-links` grün).

## In Arbeit

- **UI-Teil von BUG-0161**: Klick auf „Starten“ im Formular tut bei einem noch
  fehlenden Ordner nichts (kein POST, keine Fehlermeldung im Formular) —
  API-seitig geht es. Gehört in die PWA-Arbeit an `CreateSession.tsx` /
  `WorkplaceChoice.tsx` (Vorschau-Fehlschlag darf den Start nicht schlucken).
- BUG-0163 (Pfad-Vorbelegung, „+ Anlegen“, Wurzel-Hinweis), BUG-0162
  (Nicht-Git-Ordner in der Auswahl), BUG-0164 (mehrere Sessions pro Ordner).
- Rote Tests dafür: `outsideRoots`-Windows-Fall war vor dem Fix rot
  (alt: `true`), `isProjectPathAllowed` mit fehlendem Blatt war vor dem Fix rot
  (alter Test forderte sogar `false`, live bestärkt durch den 422 im Browser).

## Bekannte Probleme

- `npm run check:context` ist auf `main` **rot** (`reference-fresh`:
  `docs/referenz-hubctl.md`, `docs/referenz-wizard.md`,
  `docs/referenz-config.md` veraltet). `check:context` steckt in
  `npm run gate` → vor `^`-Commits Referenzen neu generieren
  (`npm run docs:reference`) als eigener `e`/`a`-Commit.
- BUG-0164 ist eine **Verhaltensänderung mit Vertragsbezug**
  (`checkout_leases`, Arbeitsort, ADR-0057) → ADR nötig; Default bleibt
  Allein-Schreiber, Mehrfach-Schreiber explicit.
- Verwandt, noch nicht als eigener Bug: ein auf Windows getipptes `/coding`
  löste zu `E:\Coding` auf (laufwerksrelativ, ohne Fehlermeldung).

## Werkzeug (Repro, nicht committet)

- `$TEMP/av/scratch-hub.mjs <roots|noroots>`: Hub mit eigenem `data/`,
  `projectRoots` (Modus `roots`) oder leeren Wurzeln (Modus `noroots`),
  Dummy-Adapter, PWA aus `apps/pwa/dist`; schreibt `STATE*.json`
  (Port, Token, Pfade, Wrapper-PID) nach `%TEMP%`.
- `$TEMP/av/kill-scratch.ps1`: tötet nur Wrapper + deren Kind-Hubs. Nach jeder
  Runde `curl http://127.0.0.1:7373/healthz` → 200 bestätigt, dass Kais
  Produktiv-Hub unberührt ist (so geprüft).

## Nächste Schritte

1. UI-Teil von BUG-0161: „Starten“ muss bei einem noch fehlenden Ordner
   tatsächlich starten (API kann es schon)
2. PWA: Pfad-Vorbelegung + „+ Anlegen“ + ehrlicher Hinweis (BUG-0163),
   Nicht-Git-Ordner in der Auswahl (BUG-0162, ADR-Entscheidung offen).
3. BUG-0164 mit ADR + ADR-Nummer aus `docs/adr/`, UI-Wortlaut der Karte
   anpassen (doppelte Meldung entfernen).
4. `npm test`, `npm run lint`, `npm run typecheck`; bei PWA-/Ablauf-Änderungen
   zusätzlich `npm run test:e2e`. Vor `^`-Commits `npm run docs:reference`
   (check:context-Hausputz) als eigener Commit.
5. Dann `pr-review` und MR via `glab`; Scratch-Hubs stoppen und `%TEMP%`-Ordner
   löschen.

## Entscheidungen (mit Grund)

- **Scratch-Hub statt Kais Instanz für kaputte Starts:** keine Fremdspur in
  `data/hub.db`, identischer Codepfad, und die Umgebung ist zugleich die
  Testbasis für die roten Tests.
- **Ein Branch für alle fünf Bugs:** sie sitzen alle an derselben Stelle
  (Session-Start ohne Git, `projects.ts`/`session-manager.ts`/
  `CreateSession.tsx`); pro Bug folgt ein eigener Commit.
- **Bug-Nummern aus den Dateien** (0161 war frei, Index sagt jetzt 0166).
