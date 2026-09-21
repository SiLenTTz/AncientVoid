# AGENTS.md — Repo-Leitfaden für Coding-Agenten

## Was das ist

UACC (`mobile-hub`): local-first Hub, um Coding-Agenten vom Handy zu
überwachen/steuern. Basis-Dokumente: `epics/` (PRD + Epics P0–P4.5, Planungsentwürfe P5–P12) —
**lesen, bevor Features gebaut werden.** Epic-Gating: P(n) startet erst,
wenn die Exit-Kriterien von P(n-1) grün sind.

## Architektur-Regeln (nicht verhandelbar)

1. **Contracts first.** Alles, was Komponenten teilen, liegt in
   `@uacc/contracts` und ist öffentlicher API-Stabilität unterworfen.
   Änderungen am Adapter-/Event-/Worker-Contract brauchen ein ADR in
   `docs/adr/`.
2. **Adapter sehen nur `AdapterContext`** (`emit`, `blob`, `spawnWorker`,
   `log`, `signal`, `workdir`, `sessionId`). Keine Hub-Internas, keine
   Imports aus `@uacc/core` oder `@uacc/server` in Adaptern.
3. **K5-Disziplin:** Payloads ≤ 4 KB; alles Große via `ctx.blob()` auslagern.
   Der EventStore erzwingt es, Adaptern soll es trotzdem nicht egal sein.
4. **K7-Disziplin:** Zustand ist aus JSONL + Snapshot rekonstruierbar. Jede
   neue State-Quelle muss einen Recovery-Pfad haben.
5. **Kein Scope-Creep:** Jedes Feature braucht eine Messlatten-Referenz
   (PRD §9, K1–K10). Epic-Scopes in `epics/EPIC-P*.md` gelten.
6. **Fail loud:** Unbekannte Provider-Formate, Adapter-Ausfälle etc. werden
   als Events/Status sichtbar, nie still gedroppt.

## Conventions

- Node ≥ 22.5, ESM, TypeScript strict, **kein Build-Schritt für Server-Code**
  (Node strip-types). Deshalb: **keine Parameter-Properties, keine Enums,
  keine Namespaces** — nur strip-taugliche TS-Syntax. PWA baut via Vite.
- Imports mit `.ts`-Endung (`./foo.ts`), `import type` wo möglich.
- npm workspaces; neue Pakete nach `packages/`, Name `@uacc/<name>`.
- Persistenz: `node:sqlite` (keine nativen Module).
- Zeitstempel ISO-8601 UTC. IDs: `crypto.randomUUID()`.
- Kommentare sparsam, auf Deutsch oder Englisch, Warum statt Was.

## Kommandos

```bash
npm test                 # vitest (Unit/Integration + E2E; E2E skippt ohne Chromium)
npm run test:e2e         # nur e2e/
npm run lint             # eslint
npm run typecheck        # tsc --noEmit
npm run loadtest         # K8: 20 Sessions × 30 ev/s
npm -w @uacc/pwa run build
```

Diese drei sind Pflicht vor jedem Commit-Vorschlag: `test`, `lint`, `typecheck`.

## Testing

- Rezept für Agenten: Skill [`write-tests`](.claude/skills/write-tests/SKILL.md)
  (Unit / Integration / E2E, rot-dann-grün, Skip-Muster).
- Unit/Contract-Tests in `packages/*/test/*.test.ts` (vitest, forks pool).
- Neue Integrations-Tests: `*.integration.test.ts` (Vorbild:
  `packages/server/test/server.test.ts`).
- E2E in `e2e/` (Playwright Chromium). Fehlt der Browser, skippt der Test
  sichtbar — analog tmux / ADR-0002. Nicht als Pass zählen.
- Adapter bekommen die Suite aus `@uacc/adapter-testkit` — grün =
  hub-integrierbar.
- tmux-Tests skipped automatisch, wenn tmux fehlt.
- Fixtures für echte CLI-Streams (P1): aufgezeichnet, anonymisiert,
  secret-gescannt — nie Roh-Logs committen.

## Datadir & Sicherheit

`data/` (SQLite, JSONL, Blobs, Worker-Logs) ist git-ignored und bleibt es.
Keine Secrets in Config-Commits; Tokens nur als Hash. Kein Code, der Agenten-
Output als Instruktion interpretiert (Prompt-Injection-Grenze, PRD §8.5).

## Arbeitsweise für Agenten

Skills unter `.claude/skills/` sind die ausführbare Form dieser Regeln —
sie duplizieren nichts hier, sie wenden es an. Index: `.claude/skills/README.md`.

- Defekt: Skill `bugfix` (Reproduce → Fix → Re-verify → Finalize). Handoff an `pr-review`.
- Neuer Bug ohne Fix: Skill `bug-report` → `bugs/bug-NNNN-slug.md`.
- Vor jedem MR: Skill `gates` (= `npm test && npm run lint && npm run typecheck`, betroffene Packages) und danach `pr-review` (6 Dimensionen inkl. Future-Fragility: Contract-Bruch, K5/K7-Verletzung, Adapter-Isolation).
- Commit/Branch/MR: Skill `git-workflow` — inkl. **fester Kadenz**: Task-Abschluss → commit; Bugfix- oder Epic-Abschluss → commit + push + MR (Solo-Projekt: Self-Merge der eigenen MR zulässig, MR bleibt Pflicht-Log). Kein Force-Push, kein Commit auf `main` außerhalb der dokumentierten Bootstrap-Ausnahme. **Der Merge selbst passiert ausschließlich über `glab mr merge`/GitLab-UI — nie über ein lokales `git merge` von einem Feature-Branch nach `main`, auch nicht als Notlösung wenn der Remote gerade nicht erreichbar ist** (dann bleibt der Branch offen und ungelöscht, bis gepusht/gemerged werden kann — siehe `git-workflow`s Regel dazu, real nötig geworden am 2026-09-18).
- Neue Phase: Skill `epic-creation` bzw. Agent `epic-planner` — Vorbild `epics/EPIC-P3-adapter-flotte-sprachsuche.md`, Premortem nie überspringen.
- Tests schreiben: Skill `write-tests`.
- Architekturfragen/Schichten: Skill `architecture-best-practices`.
- Diff wirkt überkonstruiert: Skill `ponytail-review` (Tags `delete`/`stdlib`/`native`/`yagni`/`shrink`, Invarianten via `_shared/uacc-protected-invariants.md`).

Kein Branch für nicht angewiesene Arbeit (unter einer stehenden
Autonomie-Anweisung für eine Aufgabe/ein Epic ist ein Branch **pro
Aufgabe** davon gedeckt, siehe `git-workflow`). Self-Merge der eigenen MR
ist zulässig (Solo-Projekt) — was **nicht** zulässig ist: die MR selbst zu
überspringen und stattdessen lokal nach `main` zu mergen. Kein
`--no-verify`-Äquivalent (es gibt aktuell keine lokalen Git-Hooks — die
drei Kommandos oben sind die einzige Prüfung).

Neue `.md`-Dateien: `docs/` (flach, kein Unterordner-Wildwuchs) oder
`epics/` für Epics. ADRs nach `docs/adr/NNNN-*.md`. Kein `*-STATUS.md`/
`*-SUMMARY.md` auf Top-Level.

## Definition of Done (repo-weit, P0-Standard)

Tests + Lint + Typecheck grün; neue Komponenten haben Contract-Bezug;
Messlatten-Verletzungen werden als Testfehler sichtbar; kein TODO ohne
Epic-Referenz.
