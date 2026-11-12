---
id: BUG-0125
slug: worktree-vitest-nutzt-fremde-workspace-pakete
status: open
severity: S2
area: tooling
instance: dev (Agent-Worktree unter data/worktrees/<id>)
commit: "efaa952"
forge: ""
epic: ""
created: 2026-11-12
reporter: "Agent (Claude)"
---

# BUG-0125 — Tests im Worktree laden `@ancientvoid/*` aus dem Haupt-Checkout

## Gesehen

Im Hub-Worktree ist `node_modules` leer. Node und Vitest lösen `@ancientvoid/contracts` darum über das
übergeordnete `AncientVoid/node_modules` auf — dessen Symlinks zeigen auf `packages/*` des **Haupt-Checkouts**.
Ein neues Feld in `packages/contracts` (Worktree) war für `packages/core` (Worktree) unsichtbar; ein Test schlug
fehl, obwohl der Code stimmte (und andersherum können Tests grün sein, die geänderten Code gar nicht sehen).

Gleiche Ursache: dem Worktree fehlt `node_modules/typescript`; E2E `file-diagnostics` „Projekt-tsc läuft erst nach
Freigabe“ scheitert dort, weil der Test `../../node_modules/typescript/bin/tsc` verlinkt.

## Erwartet

Tests im Worktree laufen gegen die Pakete des Worktrees, oder der Lauf bricht laut ab.

## Repro

1. Im Worktree ein optionales Feld in `ActionDefinition` (`packages/contracts/src/code/code.ts`) ergänzen und in
   `packages/core` setzen und auslesen.
2. `npx vitest run packages/core/test/modules/code` → Feld fehlt (`undefined`).
3. `node -e "console.log(require.resolve('@ancientvoid/contracts'))"` zeigt auf den Haupt-Checkout.

**Häufigkeit:** immer in Worktrees ohne eigenes `npm install`.

## Umgebung

Node 26.7.0, vitest laut Repo; Pfad `data/worktrees/e2868425-…`.

## Tests

`npm run check:workspace-links` (Teil des Gates) prüft die Links offenbar nicht gegen den Worktree-Pfad —
Vorschlag: prüfen, dass `realpath(node_modules/@ancientvoid/contracts)` unter dem Repo-Root liegt.

## Eingrenzung

`scripts/check-workspace-links.mjs`; Worktree-Anlage (Hub-Session-Lifecycle). Umgehung heute: Alias-Config oder
Symlinks in `node_modules/@ancientvoid` auf die Worktree-Pakete.

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [ ] GitLab-Issue angelegt
- [ ] `bugfix` oder offen lassen
