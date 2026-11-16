# ADR-0016 — Session-Arbeit ins Projekt übernehmen

**Status:** akzeptiert · **Betrifft:** `packages/core/src/worktree.ts`
(`apply`, `hasWork`), `SessionManager.applyToProject`,
`POST /api/sessions/:id/apply`, PWA Bericht (`WorktreeCard`)

## Kontext

Isolierte Sessions (T2.1) arbeiten in `data/worktrees/<id>` auf
`ancientvoid/<id>`. Im Handtest 2026-09-23 waren die Änderungen im Projektordner
unsichtbar, und es gab keinen Weg zurück außer Git von Hand.

## Entscheidung

1. Nur zwischen Zügen (nicht `working`/`starting`).
2. Projektordner muss sauber sein — sonst Ablehnung mit den Dateinamen;
   eigene Änderungen des Nutzers werden nie überschrieben.
3. Im Worktree `git add -A` und Commit `AncientVoid: <Titel>` (Identität des Repos,
   sonst `AncientVoid Hub <hub@ancientvoid.local>`), dann im Projekt
   `git merge --no-ff ancientvoid/<id>` in den ausgecheckten Branch.
4. Konflikt → `merge --abort`, Meldung mit Dateien, Projekt unverändert.
5. Worktree und Session bleiben; erneutes Übernehmen merged nur Neues.
   Ein vollständig übernommener, sauberer Worktree darf beim Stop weg.
6. PWA: Knopf mit Bestätigung im Bericht, Ergebnis inline und als
   Benachrichtigung (`session.applied`).

## Konsequenzen

- Kein Push, kein Rebase, keine Branch-Wahl — das bleibt beim Nutzer.
- Mit `requireStepApprovals` ist das Übernehmen noch nicht freigabepflichtig;
  wer das will, bekommt es über die Approval-Klasse `write` (P7).
