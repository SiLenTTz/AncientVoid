## What & why

<!-- One to three sentences: which issue/bug/epic task, which behavior changes. -->

Closes #

## Test evidence

<!-- Real commands and their result — not "should work". -->

```text
npm test
npm run lint
npm run typecheck
npm run test:e2e   # for PWA / route / SessionManager / adapter changes
npm run gate       # before merge
```

## Checklist

- [ ] **Gates run locally** and green (commands above; skipped tests named,
  not counted as a pass).
- [ ] **Tests added/updated**: new behavior is covered; a bug fix has a test
  that fails without the fix; new UI flows have an E2E spec in `e2e/specs/`.
- [ ] **Docs updated** where behavior, config or commands changed (README,
  `docs/`, ADR for contract changes).
- [ ] **No secrets or personal data** in the diff: no tokens, keys, real
  hostnames/IPs, home paths, raw logs; fixtures anonymized;
  `npm run check:secrets` green.
- [ ] **Commit notation**: every commit and this PR title follow
  `<risk> <intent> <area>: <sentence>` (`docs/commit-notation.md`); the PR
  title is never `@`.
- [ ] Contributions are licensed under AGPL-3.0-only plus the
  relicensing grant in `CONTRIBUTING.md` (dual licensing, ADR-0086).

## Security impact

Every new code path that **changes external state** (filesystem, SQLite,
network call, process/worker spawn, approval decision) must go through one of
the approval classes — or the exception is named here explicitly.

- [ ] **Classified**: each new external state change is `read` (free), `write`
  (confirmation) or `destructive` (WebAuthn) — or a deliberate exception with
  reason: <!-- exception + reason, if any -->
- [ ] **Fail closed** on timeout/unknown error (rejection/stop, never silent
  continuation).
- [ ] **Fail loud**: unknown/failed states become a visible event or status,
  never a silent drop.
- [ ] **Prompt-injection boundary** kept: agent output is rendered as data,
  never interpreted as an instruction.
- [ ] Auth/token handling unchanged — or the change is described here
  (tokens stay hashed).

## Architecture (one line each, "not affected" counts)

- Contract change (`packages/contracts/**`) without ADR:
- Adapter imports `@ancientvoid/core`/`@ancientvoid/hub` or bypasses `AdapterContext`:
- Event payload > 4 KB without `ctx.blob()` (K5):
- New persistent state without recovery path (K7):
- Unknown provider events silently dropped instead of a `system` event:
