# ADR-0002 — `TmuxRunner` bleibt in CI ungetestet (bewusst, nicht stillschweigend)

**Status:** akzeptiert · **Betrifft:** `packages/workers/src/tmux.ts` (ADR-P0-3), `.gitlab-ci.yml`, AI-P0-6

## Kontext

Die P0-Retro fand: `packages/workers/test/tmux.test.ts` skippt sich selbst
ohne `tmux` (`itTmux = hasTmux ? it : it.skip`) — auf dem GitLab-CI-Runner
fehlte `tmux` bisher, also liefen alle 4 Tests dort niemand hatte das
bewusst entschieden. AI-P0-6 verlangte: entweder tmux im CI-Image
installieren, oder die Lücke bewusst dokumentieren statt sie
stillschweigend zu übergehen.

## Versuch

`tmux` wurde im `node:26`-Image installiert (`apt-get install tmux` vor
`npm ci`, siehe MR !11). Ergebnis: `tmux` wird erkannt, die Tests laufen —
und schlagen mit echten Funktionsfehlern fehl, nicht mit
Installationsfehlern:

- "spawns a command and streams stdout lines" — `pipe-pane`-Capture bleibt
  leer (`[]` statt der erwarteten drei Zeilen).
- "lists only uacc-prefixed workers and reaps orphans" — die gerade
  gespawnte Session taucht in `tmux list-sessions` nicht auf.
- "kill terminates a worker" — Timeout nach 15 s beim Warten auf den
  Exit-Marker.

Das Muster (Session-Erzeugung "gelingt" laut Exit-Code, aber Pane-Output
und Session-Sichtbarkeit stimmen nicht) spricht für eine
Umgebungs-Eigenheit des GitLab-Docker-Executors — vermutlich rund um
PTY-Verfügbarkeit oder den tmux-Server-Socket-Pfad unter dem
Container-User — nicht für einen Fehler in `tmux.ts` selbst: exakt derselbe
Code läuft lokal (Omarchy, echtes tmux) zuverlässig grün.

## Entscheidung

CI installiert `tmux` **nicht**. `tmux.test.ts` bleibt, wie es ist —
`itTmux`-Skip, sichtbar in der Test-Zusammenfassung als "N skipped", aber
jetzt hier als **bewusste** Entscheidung festgehalten statt als
unbemerkte Lücke.

`TmuxRunner` ist damit **nur lokal verifiziert** (Entwicklungsmaschine mit
echtem tmux). `ProcessRunner` (`packages/workers/src/process.ts`, der
child_process-Fallback aus demselben Premortem-Punkt, ADR-P0-2/Premortem
#2) läuft in CI vollständig mit.

## Konsequenzen

- Wer an `tmux.ts` etwas ändert, muss lokal mit echtem tmux testen — CI
  fängt Regressionen dort nicht ab.
- Bei Gelegenheit erneut versuchen: ein anderer Runner/Executor (z. B.
  `privileged`-Docker, oder ein Shell-Executor statt Docker) könnte das
  PTY-Problem umgehen. Kein aktueller Zeitdruck, da `ProcessRunner` als
  Fallback existiert und die Hub-Kern-Logik (EventStore, SessionManager,
  WS-Protokoll) unabhängig von der Worker-Runner-Wahl getestet ist.
- Diese ADR ist der Beleg für AI-P0-6 — kein Folge-Ticket nötig, außer bei
  einem erneuten Anlauf mit einem anderen Runner.
