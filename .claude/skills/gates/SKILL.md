---
name: gates
description: Faehrt die Qualitaets-Gates dieses Repos (npm test/lint/typecheck/loadtest) in der richtigen Reihenfolge und im richtigen Umfang, bevor committet oder eine Aenderung als fertig gemeldet wird. Aktiv, wenn Code geaendert wurde und "ist das gruen?" beantwortet werden muss, oder wenn CI rot ist.
---

# Skill: gates

Eine Definition von „grün“ für die verbindlichen lokalen Gates. Die
Ausführungsorte verwenden dieselben Kommandos; die CI-Pflicht richtet sich
ausschließlich nach `AGENTS.md` und `docs/ci-runbook.md`:

- `gitlab.com` (Free): CI ist **nicht anwendbar als Merge-/Epic-Gate**, auch
  mit lokalem Runner. Kein Warten, Pollen, Retry oder CI-Reparaturauftrag allein
  wegen eines roten/fehlenden Cloud-Laufs; kein routinemäßiger Restpunkt dazu.
- Tatsächlich lokaler GitLab-Server als aktives Remote-/API-Ziel: Pipeline
  zusätzlich verbindlich; Runner allein reicht als Nachweis nicht.
- Lokale Gates bleiben in beiden Fällen verbindlich und blockierend.
  „CI nicht anwendbar“ ist kein Pass und kein abgeschwächter lokaler Test.

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
| `packages/adapters/*/**` | `npm test -w <package>` + `@ancientvoid/adapter-testkit`-Contract-Suite |
| `apps/pwa/**` | `npm -w @ancientvoid/pwa run build` + `npm run typecheck` + `npm run test:e2e` |
| `e2e/**` | `npm run test:e2e` (scheitert laut ohne Chromium: `npx playwright install chromium`) |
| `apps/hub/src/modules/*`, `packages/core/src/modules/sessions/*`, `packages/adapters/*` | zusätzlich `npm run test:e2e` |
| Epic- oder Bugfix-MR | `npm run gate` (alles, inkl. E2E) |
| `apps/hub/**`, `packages/core/**`, `packages/workers/**` | `npm test` + `npm run loadtest` bei State-/EventStore-Änderungen (K5/K7/K8) |
| `*.md` | kein Gate |

## Die Kommandos

```bash
npm test                 # vitest Tier A: schneller Loop (parallel, ohne die langsamen Dateien)
npm run test:slow        # vitest Tier B: langsam/seriell — Liste scripts/test-tiers.ts
npm run test:tiers       # zeigen, was in Tier B liegt (Dauern im Kommentar)
npm run test:e2e          # Playwright-E2E-Gate (docs/testing-e2e.md)
npm run gate              # typecheck + lint + test + test:slow + test:e2e
npm run lint              # eslint .
npm run typecheck         # tsc -p . --noEmit
npm run loadtest          # K8: 20 Sessions × 30 ev/s
npm -w @ancientvoid/pwa run build  # nur bei PWA-Änderungen
```

`npm test`, `npm run lint`, `npm run typecheck` sind laut `AGENTS.md` Pflicht
vor jedem Commit-Vorschlag — unabhängig vom Umfang oben, wenn Zeit reicht ist
ein voller Lauf immer korrekt, die Tabelle spart nur Zeit bei kleinen Diffs.

**Tiers:** `npm test` ist Tier A (18 s gemessen) und lässt alles weg, was lang
ist, Ports bindet oder auf Wanduhr-Zeit prüft — das läuft in
`npm run test:slow` (25 min, acp/codex/cursor-Adapter, k8-Lasttest,
device-service, ws-history, workspace-services, session-manager,
recovery-parallel). Tier B ist nötig, wenn genau diese Bereiche geändert sind,
vor jeder Epic-/Bugfix-MR und immer in `gate`/CI. Eine Datei nach Tier B
verschieben: gemessene Dauer in den Commit.

Nach roten Workspace-/Service-Läufen können verwaiste Fake-Services Ports
belegen (gemessen 66 `node`-Prozesse). Siehe Aufräum-Rezept in BUG-0167 —
niemals nach Prozessnamen killen, der eigenen Agent läuft auf Node.

## Alles auf einmal

```bash
npm test && npm run lint && npm run typecheck
```

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
