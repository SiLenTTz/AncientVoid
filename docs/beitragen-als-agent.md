# Als Agent beitragen — Workflow, Gates, Stolpersteine

**Art:** how-to

Für Agenten und Beitragende, die am Repo arbeiten (abgetrennt von
[`onboarding.md`](onboarding.md), EPIC-P57 T57.7). Regeln selbst:
[`AGENTS.md`](../AGENTS.md), [`CONTRIBUTING.md`](../CONTRIBUTING.md).

## 1. Als Agent beitragen (PR-Workflow)

Agenten folgen [`AGENTS.md`](../AGENTS.md) und
[`CONTRIBUTING.md`](../CONTRIBUTING.md):

1. Branch pro Aufgabe (`feat/…`, `fix/…`, `docs/…`), niemals direkt auf `main`.
2. Gates vor dem MR: `npm test`, `npm run lint`, `npm run typecheck`; bei
   UI-/Ablaufsänderungen `npm run test:e2e`; vor Epic-Abschluss `npm run gate`.
3. Commit-Notation `<Risiko> <Absicht> <bereich>: <Satz>` —
   [`docs/commit-notation.md`](commit-notation.md) (Hook prüft).
4. MR via `glab mr create` (Beschreibung: Warum/Änderung/Testplan), Merge nur
   über `glab mr merge`/UI, danach Source-Branch lokal+remote löschen.

## 2. Verifizieren und bekannte Stolpersteine

- `npm run gate` deckt alles ab (inkl. `check:arch`, `check:adapter-matrix`,
  E2E).
- `npm run check:workspace-links` meckert in Session-Worktrees über Pakete des
  Haupt-Checkouts → `node scripts/check-workspace-links.mjs --fix` (BUG-0069).
- Coverage-Zahl: `npm run test:coverage`.
- Hub-Neustart und Worker: Wiederanlauf ist K7-gesichert; Details zu
  Unterbrechungen in [`epics/EPIC-P27-interrupted-sessions.md`](../epics/EPIC-P27-interrupted-sessions.md).
