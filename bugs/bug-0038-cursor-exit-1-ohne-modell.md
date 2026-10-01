---
id: BUG-0038
slug: cursor-exit-1-ohne-modell
status: fixed
severity: S1
area: adapters
instance: prod
commit: "21610c1"
forge: ""
epic: "P7"
created: 2026-09-29
reporter: jan
---

# BUG-0038 — Cursor-Sessions crashen ohne Modell: Exit 1 (out of usage)

## Gesehen

Jede cursor-Session ohne explizit gewähltes Modell endet sofort mit
`cursor: process exited with code 1` → `adapter.down`; die Übersicht
füllt sich mit error-Sessions. Beobachtet live am 2026-09-28/29
(Sessions 50cec942, 60bd03d5, 1e647b35, …).

## Erwartet

Ein Zug ohne Modellwahl läuft auf `auto` (vom CLI selbst als Default
gelabelt) und endet mit Exit 0.

## Repro

1. `cursor-agent -p --output-format stream-json --trust -- "ping"` ohne
   `--model` (Login-Zustand des Nutzers).
2. Exit-Code und stderr prüfen.

**Ergebnis nach Schritt 2:** Exit 1, `ActionRequiredError: You're out of
usage. Switch to Auto…` — der Konto-Default ist „Grok 4.7 256K Medium",
nicht `auto`, obwohl der Katalog `auto - Auto (default)` schreibt.
**Häufigkeit:** immer (kontodependent).

## Eingrenzung

`packages/adapters/cursor/src/index.ts` — `CursorConfig.model` war
`optional()`; ohne `--model` greift der Konto-Default. Die Commits
549d809/e447c04/92a2a98 dokumentierten „Default auto", reichten das
Flag aber nie durch.

## Behebung (2026-09-29)

**Root-cause:** wie Eingrenzung.

**Fix:** `model: z.string().min(1).default("auto")` — der Adapter übergibt
`--model auto`, wenn weder Session noch Config ein Modell nennen. Der Fix
stammt aus Agent-Session 8a3cc1e1 (Worktree), die vor dem Committen an
mehrfachen Hub-Neustart-Recoveries starb (BUG-0036-Umfeld); hier geborgen
und unverändert übernommen inkl. Test.

**Test:** `packages/adapters/cursor/test/adapter.test.ts` „ohne Modell
läuft der Konto-Default auf out-of-usage — der Adapter setzt
--model auto": ohne Fix rot (verifiziert), mit Fix grün. Live-Verifikation
des Agenten: echter Zug mit Datei-Änderung, Exit 0, Diff-Endpoint zeigt
die neue Datei (`/tmp/opencode/livehub`, 2026-09-28T23:05Z).

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [ ] GitLab-Issue (kein Forge-Eintrag; Solo-Fix über MR)
- [x] `bugfix`
