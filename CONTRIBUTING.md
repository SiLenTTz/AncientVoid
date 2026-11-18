# Contributing to AncientVoid

Thanks for wanting to contribute! This project lives by its module
boundaries — if you respect them, your contribution is almost always small and
local. Please read the [Code of Conduct](CODE_OF_CONDUCT.md) first; security
issues go through [`SECURITY.md`](SECURITY.md), never a public issue.

Note: most of `docs/`, `epics/` and `bugs/` and the app UI are German. English
issues and pull requests are welcome.

## Who can contribute, and how

- Anyone. External contributions come as **fork + pull request** on
  [GitHub](https://github.com/securesight-ai/AncientVoid). The maintainer reviews
  and merges; there is no direct push access.
- For anything bigger than a bug fix, open an issue first (templates in
  `.github/ISSUE_TEMPLATE/`) so scope can be agreed before you invest time.
  Features need a reference to a quality bar (PRD §9, K1–K10) or an epic in
  `epics/` — no scope creep.
- **Licensing of contributions:** AncientVoid is dual-licensed: everyone
  gets it under [AGPL-3.0-only](LICENSE), and the copyright holder also sells
  a separate commercial license ([ADR-0086](docs/adr/0086-lizenz-agpl-mit-kauflizenz.md)).
  By submitting a contribution you (a) license it under AGPL-3.0-only,
  (b) grant the copyright holder a perpetual, worldwide, non-exclusive,
  royalty-free license to use, modify and sublicense it, including under
  commercial terms, and (c) confirm you have the right to do both. Please
  add a `Signed-off-by: Name <email>` trailer (`git commit -s`) as a
  [DCO](https://developercertificate.org/)-style statement of that; the
  hooks do not enforce it.

## Setup

```bash
node --version      # ^22.18.0 || ^24 || >=26 (see package.json engines)
npm install         # also installs the git hooks (.githooks/)
./setup.sh --yes --adapter=dummy --no-start   # optional: config + token + PWA
```

No build step for server code: Node runs TypeScript via type stripping. Hence
only strip-compatible syntax — **no parameter properties, no enums, no
namespaces**; imports end in `.ts`; use `import type` where possible. ESM,
TypeScript strict, persistence via `node:sqlite` (no native modules).

A fresh git worktree has no `node_modules`: run `npm install` in it before
the first gate, or it resolves workspace packages from the main checkout.

## Required local gates

GitHub Actions ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs
on every pull request and **must be green before merge** (required check on
`main`). The **local gates stay binding in addition** — run them before every
pull request and paste the summary into the PR. Details:
[`docs/ci-runbook.md`](docs/ci-runbook.md) (German).

| Change | Run |
|---|---|
| Every commit | `npm test`, `npm run lint`, `npm run typecheck` |
| PWA, server routes, SessionManager, adapters | additionally `npm run test:e2e` (Playwright Chromium; `npx playwright install chromium`) |
| Before opening a PR | `npm run gate` (typecheck, lint, commit notation, architecture, adapter matrix, context, tests, E2E) |

A skipped test (missing tmux, missing browser) is not a pass. New UI features
or flows need a new or extended spec in `e2e/specs/`. Bug fixes need a test
that fails without the fix. Testing guide: [`docs/testing-e2e.md`](docs/testing-e2e.md)
and the `write-tests` skill in `.claude/skills/`.

## Where code goes ([ADR-0020](docs/adr/0020-modular-monolith-structure.md))

| You want to … | Place |
|---|---|
| Domain logic | `packages/core/src/modules/<module>/` (public only via its `index.ts`) |
| Shared contracts | `packages/contracts/src/<module>/` |
| Adapter interface | `packages/contracts/src/harness/adapter.ts` (changes need an ADR) |
| HTTP routes | `apps/hub/src/modules/<module>/<module>.routes.ts` |
| PWA views / shared PWA code | `apps/pwa/src/features/<feature>/`, `apps/pwa/src/shared/` |
| Adapter | `packages/adapters/<name>/` (package `@ancientvoid/adapter-<name>`) |
| Worker runner | `packages/workers/` (`WorkerRunner` interface) |
| Architecture decision | `docs/adr/NNNN-*.md` |

`npm run check:arch` enforces the boundaries (e.g. adapters import only
`@ancientvoid/contracts`, never `@ancientvoid/core` or `@ancientvoid/hub`).

## Quick start: your own adapter

Connecting a provider, coding CLI or local model does not require forking the
hub. An adapter is a single module:

```ts
// adapters/my-provider/adapter.ts
import type { Adapter } from "@ancientvoid/contracts";

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

Register it in `hub.config.json` and restart the hub:

```json
{ "adapters": [ { "id": "my-provider", "module": "./adapters/my-provider/adapter.ts" } ] }
```

Rules for adapters: they see only `AdapterContext` (`emit`, `blob`,
`spawnWorker`, `log`, `signal`, `workdir`, `sessionId`); processes start only
via `ctx.spawnWorker()`; payloads stay ≤ 4 KB (large output via `ctx.blob()`);
unknown provider formats surface as `system` events, never silently dropped.
The contract suite from `@ancientvoid/adapter-testkit` must be green (template:
`packages/adapters/dummy/test/contract.test.ts`). Full guide and runnable
example: [`docs/adapters.md`](docs/adapters.md),
[`examples/adapters/openai-compat/`](examples/adapters/openai-compat/).

## Contract stability

`@ancientvoid/contracts` is public API. Changes to the adapter, event or
worker contract need an ADR in `docs/adr/`; breaking changes also need a major
version. Keep contract changes in a separate PR from their implementation.
Everything else is internal and may move.

## Commit notation

Every commit summary and PR title follows
[Arlo's Commit Notation](docs/commit-notation.md) (German doc):

```text
<risk> <intent> <area>: <sentence>
^ F pwa: show invite as QR code
. d adr: add ADR-0019
! B adapter-claude: answer question after restart
```

- **Risk:** `.` provably safe (docs/tests only, or a tool refactoring the
  typecheck fully covers) · `^` verified (`npm run gate` green and tests cover
  every changed behavior) · `!` risky (gate green, but some behavior is only
  verified live or not at all — say what in the body) · `@` probably broken
  (gate not run or red; work in progress). A PR title is **never** `@`.
- **Intent:** uppercase changes behavior — `F` feature, `B` bug fix; lowercase
  does not — `r` refactoring, `d` docs/ADR/epic, `t` tests only, `e`
  environment/tooling, `a` automated (formatting, lockfile), `m` merge.
- **Area:** package or module in lowercase (`pwa`, `core`, `hub`,
  `contracts`, `adapter-claude`, `e2e`, `adr`, …).
- One behavior change per commit; summary ≤ 100 characters.

Enforced by the `commit-msg` hook (installed by `npm install`) and by
`npm run check:commits` in the gate. The `pre-push` hook runs lint and
typecheck. Never bypass hooks (`--no-verify`).

## Branches and pull requests

- Branch names: `feat/<scope>-<slug>`, `fix/<problem>`, `docs/<scope>`,
  `test/<scope>`, `ops/<scope>`. One branch = one task = one PR, target `main`.
- One topic per PR; fill in the PR template (gates, tests, security impact).
- Every PR that fixes a defect with a tracker issue says **`Fixes #<nr>`** in
  its body — including epic-task PRs; GitHub closes the issue on merge. Issue
  lifecycle (triage, auto-close, re-open): [`docs/issues.md`](docs/issues.md).
- **No force-push** to shared branches, no rewriting of published history.
- Maintainers merge via GitHub only (merge commit titled with the PR title,
  e.g. `gh pr merge --merge --delete-branch`); never merge locally into
  `main`. Source branches are deleted after merge.
- `ancientvoid/*` branches are session worktrees created by the hub — not
  feature branches.

## Security and data rules

- **No secrets** in commits: no tokens, keys, passwords, real hostnames, IPs
  or home paths. Use placeholders (`100.64.0.10`, `tailnet-example`).
  `npm run check:secrets` scans tracked files for token-shaped secrets — it
  cannot catch hostnames, IPs or personal data, so review your diff.
- **No raw logs.** Fixtures of real CLI streams must be recorded, anonymized
  and secret-scanned before committing.
- `data/` (SQLite, JSONL, blobs, worker logs) is git-ignored and stays that way.
- Tokens are stored **only as hashes**; never log or persist a plaintext token.
- **Prompt-injection boundary:** no code may interpret agent output as an
  instruction (PRD §8.5). Agent output is data — render it escaped, never via
  `innerHTML`.
- Any new path that changes external state must go through an approval class
  (`read` / `write` / `destructive`) and fail closed on timeout or error.
- Fail loud: unknown formats and adapter failures become visible events or
  status, never silent drops.
- New persistent state needs a recovery path (state must be reconstructible
  from JSONL + snapshot, K7).

## Documentation

New Markdown files go into `docs/` (flat) or `epics/`; ADRs into
`docs/adr/NNNN-*.md`. Frozen analyses carry the date in the file name.
`npm run check:context` checks line budgets, links, references and freshness
of living documents. No TODO without an epic reference.
