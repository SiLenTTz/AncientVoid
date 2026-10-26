# ADR-0037 — Stabile UACC-*Worker-Marker

**Status:** akzeptiert · **Betrifft:** EPIC-P17 T17.5/T17.6, `packages/contracts/src/sessions/worker.ts` (`WorkerSpec.sessionId`, `WorkerInfo.sessionId`/`workerId`), `packages/workers/src/tmux.ts`, `packages/workers/src/orphans.ts`, `packages/core` SessionManager, `packages/core` worktree-hygiene, `apps/hubctl/src/worktrees.ts`

## Kontext

Worker-Identität nach Hub-Restart hing an der Konvention „tmux-Session-Name =
`uacc-<sessionId>`" plus Owner-Hash (ADR-0014, BUG-0019). Der Name ist
übersteuerbar (`SpawnOptions.name`) und von Hand umbenennbar — ein umbenannter
Worker wurde nicht adoptiert, sondern vom Orphan-Reap getötet. `worktrees
prune` (EPIC-P14) erkennt laufende Worker nur am `/proc/<pid>/cwd`; ein
Agent, der das Verzeichnis verlässt, wird unsichtbar und verliert seinen
Worktree.

## Entscheidung

1. Der TmuxRunner schreibt beim Spawn vier Marker: die Session-Optionen
   `@uacc_session` (Hub-Session-ID) und `@uacc_worker` (`randomUUID` pro
   Spawn) sowie die Pane-Env `UACC_SESSION_ID`/`UACC_WORKER_ID`
   (`set-environment`, an den respawn-ten Prozess vererbt).
2. Quellen-Trennung: maschinenlesbare Identität für `list()`/`adopt()`/
   Reapen sind die Session-**Optionen** (ein `list-sessions -F`, keine
   Zusatzprozesse); die Pane-**Env** ist der Marker im Worker selbst und für
   `/proc`-Leser (Muster: `orphans.ts` `liveHubRoots` mit `UACC_CONFIG`).
3. `adopt()`, `reapOrphans()`, `hasLiveWorker()` und prune matchen primär den
   Marker; Name bzw. cwd sind **geloggte** Fallbacks (für Worker von Hubs vor
   T17.5) — bis T12.5 den Marker-Pfad breit belegt hat (EPIC-P17 §3).
4. Härtung nach BUG-0012-Muster: `UACC_SESSION_ID`/`UACC_WORKER_ID` sind in
   `spec.env` **reserviert** (fail loud, kein Spawn — sonst könnte ein
   Aufrufer die Identität einer fremden Session fälschen); Marker-Werte
   müssen `[A-Za-z0-9][A-Za-z0-9_-]{0,127}` entsprechen. Werte sind
   Hub-interne IDs/UUIDs, nie Nutzereingabe.
5. Contract additiv: `WorkerSpec.sessionId?`, `WorkerInfo.sessionId?`/
   `workerId?`; `adopt(sessionId)` behält die Signatur, die Semantik
   „Marker primär, Name Fallback" gilt runnerseitig. ProcessRunner bleibt
   unberührt (keine Marker, kein adopt — Verhalten unverändert).

## Folgen und Risiko

- Marker sind Identität, keine Sicherheitsgrenze: Ein Pane-Prozess kann wie
  jeder tmux-Client `tmux set-option` rufen — dasselbe Trust-Niveau wie
  heute (`kill-session` ging auch). Der Reserved-Key-Guard verhindert nur
  das Fälschen über `spec.env`, nicht aus dem Pane heraus.
- `adopt()` findet umbenannte Sessions jetzt korrekt; Log- und Offset-Datei
  heißen weiterhin nach dem Originalnamen — Umbenennen bleibt kein
  unterstützter Ablauf (ein Rename stoppt das Tailen neuer Ausgaben).
- `set-environment -t` braucht tmux ≥ 3.2; `isAvailable()` prüft die
  Version, das Repo entwickelt gegen 3.3–3.7.
- K7 unverändert: `list()` liest 6 statt 4 Format-Spalten in demselben
  einen `list-sessions`-Aufruf — kein Zusatzprozess, kein zweiter Roundtrip.

## Messlatten

K7 (100 % Worker-Zuordnung nach Hub-Restart, < 3 s Restore — belegt durch
`recovery-marker.test.ts` mit zwei Adaptern), K9-Geist (Fallback-Wege sind
geloggt, nie still).
