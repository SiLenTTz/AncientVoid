---
name: gates
description: Faehrt die Qualitaets-Gates dieses Repos (gezielte Tests der geaenderten Verhaltensweise + lint/typecheck; breite Läufe wie npm test/test:slow/test:e2e/gate nur auf ausdrücklichen Auftrag) in der richtigen Reihenfolge und im richtigen Umfang, bevor committet oder eine Aenderung als fertig gemeldet wird. Aktiv, wenn Code geaendert wurde und "ist das gruen?" beantwortet werden muss, oder wenn CI rot ist.
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
| `*.md` | kein Gate |

## Die Kommandos

```bash
npm test                 # vitest Tier A: schneller Loop (parallel, ohne die langsamen Dateien)
npm run test:slow         # langsamer Satz (VITEST_SET=slow) — Liste scripts/slow-tests.json
npm run test:tiers        # zeigen, was in Tier B liegt (Dauern im Kommentar)
npm run test:e2e          # Playwright-E2E-Gate (docs/testing-e2e.md)
npm run gate              # typecheck + lint + test + test:slow + test:e2e
npm run lint              # eslint .
npm run typecheck         # tsc -p . --noEmit
npm run loadtest          # K8: 20 Sessions × 30 ev/s
npm -w @ancientvoid/pwa run build  # nur bei PWA-Änderungen
```

`npm run lint` und `npm run typecheck` sind laut `AGENTS.md` Pflicht vor jedem
Commit-Vorschlag, dazu **die Tests, die genau die geänderte Verhaltensweise prüfen**
(Datei beim Namen genannt, rot-dann-grün). **Kein breit laufender Test als Standard**
(Nutzerentscheid 16.11.2026): `npm test` (Tier A), `npm run test:slow`, ein volles
`npm run test:e2e` oder ganze Suiten/Matrizen nur auf ausdrücklichen Auftrag —
`ci.yml` (schnell) und `nightly.yml` (voll) fahren die volle Messlatte, und jeder
Push auf einem PR-Zweig wirft sie komplett neu an (dann ~20 min E2E).

**Tiers:** `npm test` ist Tier A (18 s gemessen) und lässt weg, was lang ist,
Ports bindet oder auf Wanduhr-Zeit prüft — das läuft seriell in
`npm run test:slow` (~25 min lokal: acp/codex/cursor-Adapter, k8-Lasttest,
device-service, ws-history, workspace-services, session-manager,
recovery-parallel). Tier B ist nötig, wenn genau diese Bereiche geändert sind,
vor jedem Bugfix-/Epic-PR, und immer in `gate`/`ci.yml`. Datei nach Tier B
verschieben: gemessene Dauer in den Commit.

Nach roten Workspace-/Service-Läufen können verwaiste Fake-Services Ports
belegen (gemessen 66 `node`-Prozesse). Rezept in BUG-0170 — niemals nach
Prozessnamen killen, der eigene Agent läuft auf Node.

## Voller Lauf — nur auf ausdrücklichen Auftrag

```bash
npm test && npm run lint && npm run typecheck   # Tier A breit
npm run test:slow                               # seriell, ~25 min lokal
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
