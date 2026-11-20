# ADR-0098 — claude-Adapter: ein Streaming-Input-Prozess je Session (midTurnInput)

**Status:** akzeptiert (Nutzerauftrag 20.11.2026: „Alle Adapter, Provider und
LLMs müssen ihre komplette Funktionalität behalten — wir sind nur eine
verbesserte IDE, die sie nutzt“) · **Betrifft:** BUG-0235,
`packages/adapters/claude/src/index.ts`, `docs/adapters.md` · **Bezug:**
ADR-0013 (Nachtrag: persistente Worker), ADR-0074 (kein Zweitprozess auf
eine native Session), ADR-0076 (Zustellung), ADR-0085 (midTurnInput)

## Kontext

Live-Fund (BUG-0235): claude fährt in einer Hub-Session einen ~3,5-stündigen
Hintergrundprozess. `claude -p` wartet Zugende offenes Background-Work ab
(dokumentiertes CLI-Verhalten „Background tasks at exit“) — solange gilt die
Session im Hub als `working`. Jede weitere Nachricht wird vorgemerkt;
„Jetzt senden“ lehnt der Hub ab, denn der Adapter versprach
`promptDelivery: "next-turn"` ohne `midTurnInput`
(`session-manager.ts`, `sendQueuedNow`). Die interaktive CLI ist in
derselben Situation bedienbar: Ihr Eingabekanal (stdin des persistenten
Prozesses) bleibt offen — Getipptes wird im laufenden Zug bei Tool-Grenzen
injiziert (Steering) oder startet den nächsten Zug, während die
Hintergrundarbeit weiterläuft.

Der Adapter fuhr One-Shot-Print-Mode: `claude -p "<prompt>"` mit dem Prompt
im **Argv**, stdin ungenutzt; jeder Zug ein neuer Prozess über
`--resume <session_id>`. Einen laufenden Prozess zu steuern ist über Argv
unmöglich, und ein paralleler `--resume`-Prozess wäre der ADR-0074-Verstoß
(zwei Schreiber auf eine native Session). Die Ablehnung war korrekt — das
Fehlen der Alternative war der Defekt.

Dasselbe Capability-Modell existiert im Contract seit ADR-0085
(`midTurnInput`), und dasselbe Prozess-Modell existiert im Hub seit dem
ADR-0013-Nachtrag (`stdin: "pipe"`, `persistent: true`, `ctx.turn()`) —
erprobt mit codex app-server und ACP. Die CLI ihrerseits hat den Kanal
headless dokumentiert: `--input-format stream-json` („realtime streaming
input“), Nutzer-Nachrichten als NDJSON auf stdin, `result`-Events je Zug,
Zwischenrufe erreichen Claude nach dem laufenden Tool-Call (Agent-SDK-Doku
„Send messages to a running agent“). Versionsschwelle: benötigt wird eine
CLI, die Streaming-Input nimmt (verifiziert an 2.1.329).

## Entscheidung

1. **Ein persistenter Streaming-Prozess je Session.** `start()` mit Prompt
   spawnt `claude -p --input-format stream-json --output-format stream-json
   --verbose [--resume <id>] [--agent] [--model] [--permission-mode …]` über
   `ctx.spawnWorker(cmd, { stdin: "pipe", persistent: true, env })`. Der
   erste Prompt geht als NDJSON-User-Nachricht auf den stdin-Kanal, nicht
   ins Argv. Der Prozess bleibt über Zugenden hin offen.
2. **Steering ist eine stdin-Zeile.** `steer(prompt)` schreibt in den
   **laufenden** Prozess (`proc.write`), solange einer lebt — nie ein
   Zweitprozess (ADR-0074 bleibt unangetastet, jetzt strukturell
   garantiert). Erst wenn kein Prozess lebt (nach Exit, nach Park/Stop,
   nach Hub-Recovery ohne Adoption), spawnt der nächste Prompt einen neuen
   `--resume`-Prozess. Ein Steering mitten im Zug erreicht Claude nach dem
   laufenden Tool-Call — genau das CLI-Verhalten.
3. **Zug-Reporting über `ctx.turn()`.** Jede gesendete Nachricht meldet
   `ctx.turn("working")`. Ein `result` ohne weitere native Vormerkungen meldet
   das Hauptzugende. Der Hub liefert die nächste Vormerkung aus, während
   offene Hintergrundaktivitäten die Session weiterhin auf `working` halten.
4. **Capability ehrlich auf `midTurnInput: true`** (mit
   `promptDelivery: "next-turn"` wie Pi): Der ⚡-Chip (ADR-0085) erscheint,
   `sendQueuedNow` liefert während des laufenden Zugs aus, und die
   Vormerkung bleibt der Standard für alle, die batching wollen.
5. **Exit-Semantik (BUG-0008 bleibt sinngemäß):** Ein Exit mit Code ≠ 0
   markiert den Adapter `down` (per Heartbeat sichtbar); ein sauberer Exit
   ist das Ende des Streaming-Prozesses, nicht der Session — `meta` mit
   `resumeSessionId` bleibt liegen, der nächste Prompt startet einen neuen
   Prozess. Der Hub behandelt den Verlust eines persistenten Workers als
   Unterbrechung (`trackPersistentWorker` → `interrupt("worker_exit")`).
6. **Attachments unverändert:** Prompt-Text inklusive Anhänge weiter über
   `promptWithAttachments`, Verzeichnisse über `--add-dir` beim Spawn. Ein
   `--add-dir` für einen nachgereichten Anhang am laufenden Prozess gibt
   es nicht — die Datei bleibt über ihren Pfad im Prompt erreichbar, ein
   nötiger Lese-Zugriff geht über die Freigabe-Brücke (ADR-0018 §3). Fail
   loud: ein System-Event nennt den Verzicht, wenn ein Anhang im laufenden
   Zug Verzeichnisse mitbringt.

## Grenzen (bewusst)

- **Kein `--bare`:** Bare-Mode deaktiviert Hintergrundarbeit — er widerspräche
  dem Auftrag, die CLI-Funktionalität vollständig zu erhalten.
- **`stop`/`park` bleiben SIGTERM:** Das ist das dokumentierte CLI-„run
  beenden“ (beendet auch laufende Bash-Prozesse des Runs). Ein weicheres
  Interrupt (SIGINT/`interrupt()`) wäre ein eigenes Thema, nicht Teil dieses
  ADRs.
- **`configure` bleibt nutzbar:** Beim laufenden Prozess gehen Modell und
  Modus als bestätigte Control-Requests über stdin. Beim neuen Prozess
  gelten weiterhin `--model` und `--permission-mode`.
- **`--replay-user-messages` aus:** Der Hub braucht den Write-Deckel nicht;
  sein eigenes `session.prompt`-Event ist die Quelle der Wahrheit (K7).

## Konsequenzen

- BUG-0235 ist behoben: Während des laufenden Zugs — auch über Stunden
  Hintergrundarbeit — sind „⚡ lenken“ und „Jetzt senden“ möglich; die
  Warteschlange geht nach jedem Zugende raus, nicht nach dem Abklingen aller
  Hintergrundarbeit.
- Der One-Shot-Test-Korpus des Adapters wird auf Streaming-Semantik
  umgestellt (stdin-Asserts statt Argv-Asserts; `result` → `ctx.turn`).
- `docs/adapters.md` beschreibt claude nicht mehr als „ein Prozess pro Zug“,
  sondern als persistenten Streaming-Input-Prozess (wie codex app-server).
- Recovery-Pfad (K7) bleibt: Exit/Absturz → `meta.resumeSessionId` → der
  nächste Prompt startet einen frischen `--resume`-Prozess; adoption über
  `recover()` mit `persistent: true`.
- Der Contract erhält `WorkerProcess.stdinMode?`. Ein übernommener
  One-Shot-Worker ohne FIFO bekommt keine NDJSON-Eingabe. Nach seinem
  Abschluss nimmt ein neuer Streaming-Worker die nächste Nachricht an.

## Alternativen (verworfen)

- **Zweiter `--resume`-Prozess für „Jetzt senden“:** ADR-0074-Verstoß; zwei
  Schreiber auf dieselbe native Session, Reihenfolge und Transkript
  unbestimmt.
- **Wartenden Prozess unterbrechen (SIGINT/SIGTERM) und dann erst resumes:**
  tötet oder verliert die Hintergrundarbeit, deren Ergebnis-Claude genau
  dann verwerten will — Funktionalitätsverlust, kein Steering.
- **Queue drain trotz `working` zulassen:** hieße Prompt an einen toten
  Kanal delivern oder heimlich doch den Zweitprozess öffnen — nur sauber
  lösbar über den echten Eingabekanal, also diese Entscheidung.

## Nachtrag (2026-11-20): Capability `promptlessStartIdle`

E2E-Fund bei der Umstellung: Ein promptloser claude-Start (Session-Anlage
ohne Startprompt) spawnt jetzt nichts mehr — der Hub markierte ihn aber wie
bisher als `working`, und ohne Zug-Prozess, `ctx.turn` oder Aktivität kann
dieser Zustand nie mehr auf `idle` settle'n (vor ADR-0098 erledigte ihn der
One-Shot-Prozess mit seinem Exit). BUG-0039 kannte das Problem schon für
Übernahmen („working würde lügen“), durfte es aber nur dort anwenden, weil
Adapter wie dummy auch ohne Prompt sofort Arbeit haben.

Deshalb additiv in den Contracts: `AdapterCapabilities.promptlessStartIdle?:
boolean` — die Zusicherung des Adapters, dass sein promptloser Start keinen
Prozess und keinen Zug hinterlässt. Der Hub öffnet solche Sessions direkt
`idle` (Übernahmen unverändert darüber mit abgedeckt). claude setzt sie;
pi und hermes haben denselben promptlosen Idle-Pfad und können folgen.
