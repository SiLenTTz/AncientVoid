---
id: BUG-0183
slug: test-laeufe-ueberschreiben-das-live-buendel-des-hubs
status: done
severity: S1
area: tests
instance: prod
commit: ""
forge: ""
epic: ""
created: 2026-11-16
reporter: kai (Handy über Tailnet)
---

# BUG-0183 — jeder Test-Lauf überschreibt das Bündel, das der laufende Hub am Handy servt

## Gesehen

Kai, 16.11. abends: „wo sind jetzt meine ganzen Änderungen — das mit dem Stopp-Knopf,
das mit dem Drehen, alles nicht da auf meinem Handy.“

Die Korrekturen waren gebaut, gemerged und auf dem Live-Zweig — am Handy waren sie
dennoch weg.

## Ursache

Der laufende Hub servt die PWA aus `apps/pwa/dist` (`hub.config.json`:
`"pwaDir": "./apps/pwa/dist"`). **Dasselbe Verzeichnis ist das Bauziel von Tests:**

* `e2e/support/global-setup.ts` baute vor jedem Playwright-Lauf
  `npm -w @ancientvoid/pwa run build` → genau dorthin.
* `scripts/guide-shots.ts` ebenso, `scripts/demo-seed.ts` servt es.

Ein Agent, der gerade an einem PR-Zweig arbeitet und *eine einzige* Spec fährt, baut
das Bündel dieses Zweigs in den Live-Ordner. Der Hub liefert es sofort — ohne dass
jemand „deployt“ hätte. Die App am Handy war also korrekt aktualisiert: nur auf den
falschen Stand.

## Gemessen

| | Stand |
|---|---|
| Live-Bündel (Live-Zweig, alle Fixes drin) | `assets/index-IKPQTiCH.js`, `index.html` sha1 `58fcdc7f…` |
| dasselbe Verzeichnis nach einem Playwright-Lauf vom PR-Zweig | anderes Bündel, Marker „erneut tippen stoppt“ / `nyx-fab-stop` / `strip-col` **nicht mehr enthalten** |
| nach Rückwechsel + Neubaust | `index-IKPQTiCH.js` wieder ausgeliefert, Marker wieder da |

## Erwartet

Test- und Guide-Läufe dürfen das ausgelieferte Bündel eines laufenden Hubs nicht
anrühren. Jedes Werkzeug bekommt sein eigenes Bauziel.

## Fix

* E2E: `e2e/support/hub.ts` exportiert `E2E_PWA_DIST = apps/pwa/dist-e2e`, der
  Test-Hub servt dieses Verzeichnis; `global-setup.ts` baut mit
  `--outDir dist-e2e --emptyOutDir`.
* Guide: `guide-shots.ts` baut nach `apps/pwa/dist-guide`; `demo-seed.ts` nimmt
  `dist-guide`, wenn es existiert, sonst das ausgelieferte `dist` (Starten wie bisher).
* `apps/pwa/dist-e2e/` und `apps/pwa/dist-guide/` sind git-ignored.

## Bewiesen

* Playwright-Lauf `e2e/specs/oberflaeche.spec.ts -g "pi mit Fenster"` (1 grün, 5,4 s)
  **bei unverändertem Live-Bündel**: `apps/pwa/dist/assets/index-IKPQTiCH.js` und
  `index.html` sha1 `58fcdc7f…` vorher = nachher; neu entstanden ist
  `apps/pwa/dist-e2e/assets/index-Ih2HndK-.js`.
* Smoke für den Guide-Pfad: Demo-Hub auf 127.0.0.1:4599 → `/healthz` 200, `/` liefert
  `assets/index-IKPQTiCH.js` (Fallback auf `dist`, weil `dist-guide` noch nicht gebaut
  war) — Fallback wie vorgesehen. Prozess danach gezielt beendet (PID 25852),
  7373 unverändert 200.
* `npm run typecheck`, `npm run lint`: grün.

## Nicht geprüft

* Kein voller `npm run test:e2e`-Lauf (Regel: breite Läufe nur auf Auftrag) und kein
  Guide-Lauf (Screenshot-Strecke) — der Guide-Pfad ist über den Smoke des Demo-Hubs
  belegt, die Guide-Screens selbst nicht neu gemacht.

## Folgerung für die Arbeit

Solange ein laufender Hub am Handy hängt: nicht vom PR-Zweig aus bauen, sondern
Arbeitszweige in eigenen Worktrees führen — oder eben dieses Getrennte Bauziel nutzen.
