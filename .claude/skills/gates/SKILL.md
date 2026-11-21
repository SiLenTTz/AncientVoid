---
name: gates
description: Faehrt die Qualitaets-Gates dieses Repos (gezielte Tests der geaenderten Verhaltensweise + lint/typecheck; breite Läufe nur auf ausdrücklichen Auftrag) in richtiger Reihenfolge vor Commit und Fertigmeldung. Aktiv bei "ist das gruen?", vor Commit, bei roter CI.
---

# Skill: gates

Eine Definition von „grün“ für die verbindlichen lokalen Gates. Die
Ausführungsorte verwenden dieselben Kommandos; die CI-Pflicht richtet sich
ausschließlich nach `AGENTS.md` und `docs/ci-runbook.md`:

- GitHub Actions (`.github/workflows/ci.yml`, Job `verify`) läuft auf jedem
  PR und ist Pflicht-Check für den Merge nach `main` (`gh pr checks <nr>`).
  Die Vollsuite (`nightly.yml`, inklusive K8/E2E) läuft zweimal täglich
  auf `ci/full-suite`; jeder main-Push synchronisiert diesen Zweig.
  Fehler erzeugen GitHub-Bugs (`nightly-bugs.yml`). Details und rote Läufe:
  `docs/ci-runbook.md`.
- Lokale Gates bleiben zusätzlich verbindlich und blockierend — grüne CI
  ersetzt sie nicht, sie ersetzen grüne CI nicht.
- Rot allein wegen der Umgebung (Runner-Flake, Dienst-Ausfall) wird benannt
  und neu gestartet, nie als Pass gemeldet.

## Umfang bestimmen — nicht alles fahren

Erst feststellen, was sich geändert hat:

```bash
git status --porcelain
git diff --name-only HEAD
```

Dann nur die Spalten fahren, die betroffen sind.

| Geändert | Zu fahren |
|---|---|
| `packages/contracts/**` | alles (Contract-Änderung propagiert in jedes Package) + ADR-Pflicht (`AGENTS.md` Regel 1) |
| `packages/adapters/*/**` | `npx vitest run packages/adapters/<name>/test` (Contract-Suite aus `@ancientvoid/adapter-testkit`) |
| `apps/pwa/**` | `npm -w @ancientvoid/pwa run build` + `npm run typecheck` + `npx playwright test e2e/specs/<betroffene Spec>.spec.ts` |
| `e2e/**` | `npx playwright test <die geänderten Specs>` (scheitert laut ohne Chromium: `npx playwright install chromium`) |
| `apps/hub/src/modules/*`, `packages/core/src/modules/sessions/*`, `packages/adapters/*` | zusätzlich die betroffene Spec in `e2e/specs/` |
| Epic- oder Bugfix-PR | `npm run gate` **nur auf ausdrücklichen Auftrag** — CI fährt `ci.yml` (schnell) und `nightly.yml` (voll) |
| `apps/hub/**`, `packages/core/**`, `packages/workers/**` | `npx vitest run <Ordner des betroffenen Moduls>`; `npm run loadtest` bei State-/EventStore-Änderungen (K5/K7/K8) |
| `*.md` | kein Gate; bei `epics/**` und `docs/epic-status.md`: `npm run check:epics` + `npm run check:context` |

## Die Kommandos

```bash
npm test                 # vitest: die volle Suite (Tier A + B zusammen)
npm run test:fast        # vitest Tier A: schneller Loop (parallel; ohne die Dateien aus scripts/slow-tests.json)
npm run test:slow         # langsamer Satz (VITEST_SET=slow) — Liste scripts/slow-tests.json
npm run test:e2e          # Playwright-E2E-Gate (docs/testing-e2e.md)
npm run gate              # check:* + typecheck + lint + volle Suite + test:e2e
npm run check:epics       # Status-/Checklisten-Drift der Epics (exit 1 bei Drift)
npm run lint              # eslint .
npm run typecheck         # tsc -p . --noEmit
npm run loadtest          # K8: 20 Sessions × 30 ev/s
npm -w @ancientvoid/pwa run build  # nur bei PWA-Änderungen
```

`npm run lint` und `npm run typecheck` sind laut `AGENTS.md` Pflicht vor jedem
Commit-Vorschlag, dazu **die Tests, die genau die geänderte Verhaltensweise prüfen**
(Datei beim Namen genannt, rot-dann-grün). **Kein breit laufender Test als Standard**
(Nutzerentscheid 16.11.2026): `npm test` (volle Suite), `npm run test:slow`, ein volles
`npm run test:e2e` oder ganze Suiten/Matrizen nur auf ausdrücklichen Auftrag —
`ci.yml` (schnell) und `nightly.yml` (voll) fahren die volle Messlatte, und jeder
Push auf einem PR-Zweig wirft sie komplett neu an (dann ~20 min E2E).

**Tiers:** Tier A ist `npm run test:fast` (die PR-Gate-Messlatte aus `ci.yml`)
und lässt weg, was lang ist, Ports bindet oder auf Wanduhr-Zeit prüft — das
läuft seriell in `npm run test:slow` (~25 min lokal: acp/codex/cursor-Adapter,
k8-Lasttest, device-service, ws-history, workspace-services, session-manager,
recovery-parallel; Liste `scripts/slow-tests.json`). Tier B ist nötig, wenn
genau diese Bereiche geändert sind, vor jedem Bugfix-/Epic-PR, und immer in
`npm test`/`gate`/`nightly.yml`. Datei auf die Slow-Liste setzen: gemessene
Dauer in den Commit.

Nach roten Workspace-/Service-Läufen können verwaiste Fake-Services Ports
belegen (gemessen 66 `node`-Prozesse). Rezept in BUG-0170 — niemals nach
Prozessnamen killen, der eigene Agent läuft auf Node.

## Voller Lauf — nur auf ausdrücklichen Auftrag

```bash
npm run test:fast && npm run lint && npm run typecheck  # Tier A breit
npm run test:slow                               # seriell, ~25 min lokal
npm run test:fast && npm run test:slow           # = npm test (volle Suite)
npm run test:e2e                                # echter Hub + alle Specs
npm run gate                                    # alles zusammen
```

Standard ist der gezielte Lauf: `npx vitest run <Testdatei>`, `npx playwright test
<Spec>`. Ein breiter Lauf ersetzt keinen gezielten Nachweis, dass genau das geänderte
Verhalten stimmt (`AGENTS.md`: „Fertig heißt verifiziert“).

## Wenn ein Gate rot ist

1. **Ursache lesen, nicht Symptom.** Die Meldung nennt Datei und Zeile.
2. **Das Gate nicht entschärfen.** Test skippen, Typ auf `any` weichspülen,
   ESLint-Regel ausnehmen — das alles verschiebt den Fehlschlag, es behebt
   nichts.
3. **Ist das Gate selbst kaputt** (fehlendes Werkzeug, kaputte Umgebung), ist
   das ein eigener Befund und wird gemeldet, nicht umgangen.
4. **Ratschen nur nach unten.** Es gibt in diesem Repo noch keine
   Baseline-Dateien (das Repo ist dafür zu jung) — sollte später eine
   Altlast-Ratsche eingeführt werden (z. B. `eslint --max-warnings`), gilt:
   wer eine Altlast behebt, streicht ihre Zeile; wer eine neue einbaut, wird
   blockiert.

## Grenzen

Der Skill führt Prüfungen aus und liest ihr Ergebnis. Er entscheidet nicht,
ob eine Änderung fachlich richtig ist — dafür ist [`pr-review`](../pr-review/SKILL.md)
da. Ein grüner Lauf belegt nur, was die Gates messen: Compiler, Typen, Tests,
Durchsatz. Angemessenheit messen sie nicht.

Index: [`.claude/skills/README.md`](../README.md).

## PWA-Oberflächenwächter: was bei UI-PRs regelmäßig zuschlägt (PR #200, 19.11.2026)

- `apps/pwa/test/css-tokens.test.ts` (AC-P63-3): jede in TSX benutzte Klasse braucht eine
  CSS-Regel. Erwischt auch Klassen einer Komponente, die nur versehentlich im Zweig liegt.
- `apps/pwa/test/ui-primitives.test.ts` (AC-P63-4): Ratchet für Inline-Style-Objekte
  (Grenze in `apps/pwa/test/css-ratchet.json`, aktuell 24). Ein positioniertes Popover
  positioniert deshalb imperativ (`el.style.left/top` nach der Messung), Grundposition aus
  dem CSS. Der Zähler ist ein Regex — ein Kommentar, der das Literal nennt, zählt mit.
- `e2e/specs/settings-layout.spec.ts`: die `GROUPS`-Liste ist das Inventar der
  Einstellungen-Gruppen in Handy-Reihenfolge. Neue `SettingsSection` → dort eintragen.

## Rot-Beweis: wiederhergestellte Dateien wieder loswerden

`git checkout <basis> -- <produktdateien>` (Specs gegen den Stand vor dem Fix laufen
lassen) holt auch gelöschte Dateien zurück. `git checkout HEAD -- .` entfernt sie danach
**nicht** — in HEAD kommen sie nicht mehr vor. Sie bleiben im Arbeitsbaum, werden mit dem
nächsten `git add <ordner>` wieder getrackt und laufen als tote Klassen in den css-tokens-
Guard (PR #200: zwei verlorene CI-Läufe). Sicherer Weg: `git rm -f <die gelöschte Datei>`
**vor** dem Zurückholen; danach zwei Checks — `git status --short` leer **und**
`git ls-files | grep <datei>` leer (der Status-Check allein ist blind, weil die Datei im
Index landen kann).
