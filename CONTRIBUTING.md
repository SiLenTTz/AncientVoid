# Contributing zu AncientVoid

Danke, dass du beisteuern willst! Dieses Projekt lebt von der Modulgrenze —
wenn du sie respektierst, ist dein Beitrag fast immer klein und lokal.

## Der schnellste Weg: ein eigener Adapter

Du willst einen **eigenen Provider**, ein **Coding-Tool** oder ein **lokales
Coding-System** anbinden? Dafür musst du den Hub nicht forken. Ein Adapter
ist ein einzelnes Modul:

```ts
// adapters/my-provider/adapter.ts
import type { Adapter, AdapterContext, SessionHandle } from "@uacc/contracts";

export function createAdapter(config?: Record<string, unknown>): Adapter {
  return {
    id: "my-provider",
    version: "0.1.0",
    capabilities: () => ({ reasoning: false, tools: false, cost: false, steer: false }),
    async start(spec, ctx) {
      ctx.emit({ type: "system", summary: "started", payload: {} });
      return { sessionId: ctx.sessionId };
    },
    async steer(handle, input, ctx) { return { ok: true }; },
    async status() { return { state: "healthy" }; },
    async stop() {},
  };
}
```

In `hub.config.json` eintragen:

```json
{ "adapters": [ { "id": "my-provider", "module": "./adapters/my-provider/adapter.ts" } ] }
```

Hub neu starten — fertig. Details, Regeln und das Testkit:
**[`docs/adapters.md`](./docs/adapters.md)**. Vollständiges, lauffähiges
Beispiel: [`examples/adapters/openai-compat/`](./examples/adapters/openai-compat/).

## Andere Einstiegspunkte

| Du willst … | Ort |
|---|---|
| Adapter beisteuern (npm-Paket `uacc-adapter-*`) | `docs/adapters.md` |
| Adapter-Verhalten verändern/erweitern | `packages/contracts/src/adapter.ts` + ADR |
| Anderen Worker-Runner (z. B. WSL, remote) | `packages/workers/` (`WorkerRunner`-Interface) |
| Frontend | `apps/pwa/` (Preact, bewusst klein) |
| Doku/Epics | `docs/`, `epics/` |

## Verpflichtend für jeden Beitrag

1. `npm test && npm run lint && npm run typecheck` — grün.
2. Adapter: Contract-Suite aus `@uacc/adapter-testkit` grün (siehe
   `packages/adapters/dummy/test/contract.test.ts` als Vorlage).
3. Keine Secrets, keine Roh-Logs. `data/` bleibt git-ignored.
4. Neue Komponenten brauchen Contract-Bezug (AGENTS.md, Regel 1 & 5).
5. Conventions aus `AGENTS.md` gelten für Menschen und Agenten gleichermaßen.

## Contract-Stabilität

`@uacc/contracts` ist öffentliche API. Breaking Changes dort brauchen ein ADR
(`docs/adr/NNN-*.md`) und eine Major-Version. Alles andere ist intern und darf
sich bewegen.

## Commits / PRs

- **Commit-Notation** (Arlo): `<Risiko> <Absicht> <bereich>: <Satz>`, z. B.
  `^ F pwa: Einladung als QR-Code`. Risiko `.`/`^`/`!`/`@`, Absicht
  `F B r d t e a m` — Kriterien in [`docs/commit-notation.md`](docs/commit-notation.md).
  Der `commit-msg`-Hook (`npm install` richtet ihn ein) und `npm run
  check:commits` im Gate prüfen das. Gilt auch für MR-Titel.
- **`pre-push`-Hook:** führt `npm run lint` und `npm run typecheck` aus (~10 s) und
  bricht den Push bei Fehlern ab; Branch-Löschungen sind ausgenommen. Tests/E2E
  bleiben beim Gate (`npm run gate`, Skill `gates`).
- Ein Thema pro PR; Contract-Änderungen getrennt von Implementierungen.
- CI (GitLab) führt `test`, `lint`, `typecheck` aus — grün vor Merge.
- **Merge passiert ausschließlich über die GitLab-MR** (`glab mr merge` oder
  UI-Klick), nie über ein lokales `git merge` von einem Feature-Branch nach
  `main` — auch nicht, wenn der Remote gerade nicht erreichbar ist. Details
  und die Kadenz (wann committen/pushen/MR öffnen): Skill
  [`.claude/skills/git-workflow/SKILL.md`](.claude/skills/git-workflow/SKILL.md).

## Git-Hygiene (saubere Historie, wenig Branches)

Ziel: `main` ist der einzige langfristige Branch. Alles andere ist kurzlebig
und verschwindet nach dem Merge.

### Branch-Regeln

| Regel | Detail |
|---|---|
| Naming | `feat/<scope>-<slug>` · `fix/<problem>` · `docs/<scope>` · `test/<scope>` · `ops/<scope>` |
| Lebensdauer | Ein Branch = eine Aufgabe = eine MR. Nach Merge löschen (lokal + remote). |
| Ziel von MRs | Standard-Ziel ist **`main`**. Stacked MRs auf einen Integrations-Branch nur als Ausnahme (Epic-Kette), und die Kette muss zeitnah nach `main` landen. |
| Keine Zombies | Fertige/gemergte Branches nicht liegen lassen. Stale Remote-Refs: `git fetch --prune`. |
| `uacc/*` | Session-Worktrees des Hubs — nicht von Hand als Feature-Branches behandeln; Aufräumen über den Hub/`git worktree remove`, nicht über MR-Hygiene. |

### Post-Merge (Pflicht, jedes Mal)

```bash
git checkout main && git pull
git branch -d <source-branch>
git push origin --delete <source-branch>   # falls GitLab es nicht schon gelöscht hat
git fetch --prune
```

GitLab hat `remove_source_branch_after_merge` aktiv — trotzdem lokal
aufräumen und bei Bedarf remote nachziehen.

### Was „saubere Historie“ hier heißt

- Eine Verhaltensänderung pro Commit (Commit-Notation).
- Kein Force-Push auf `main`, kein History-Rewrite veröffentlichter Commits.
- Kein lokales Merge nach `main` als MR-Ersatz.
- Offene Draft-MRs, die nicht mehr gebraucht werden, schließen statt ewig offen
  zu lassen.
- Einmal pro Woche (oder vor Epic-Abschluss): `git branch -a` ansehen; alles
  ohne offene MR und ohne Unique-Commits gegenüber `main` löschen.

### Audit-Schnipsel

```bash
# Remote-Branches, die nicht main sind
git branch -r | grep -v 'origin/main\|origin/HEAD'

# Lokale Branches ohne offenen Nutzen (manuell prüfen)
git branch --format='%(refname:short)' | grep -v '^main$\|^uacc/'

# Commits auf einem Branch, die nicht in main sind
git log --oneline main..<branch>
```
