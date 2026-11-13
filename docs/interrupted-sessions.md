# Unterbrochene Sessions (P27 / ADR-0044)

**Art:** erklaerung

Ein verlorener Agent-Prozess ist kein erfolgreich beendeter Zug. Die Übersicht
ordnet `interrupted` unter „Braucht dich“ ein. Im Chat zeigt das Banner Grund,
Zeitpunkt und den letzten Zug. Der Bericht nennt den Abbruch; Laufmesswerte und
Benachrichtigungen melden keinen Erfolg. Der Digest enthält das Interrupt-Ereignis.

| Grund | Bedeutung |
|---|---|
| `worker_exit` | Worker unerwartet beendet, ohne vorherigen Agent-Fehler |
| `hub_restart` | Beim Neustart aktiver Zug, dessen Worker nicht überlebt hat |
| `adapter_down` | Adapter meldet Ausfall ohne vorherigen Agent-Fehler |

Ein expliziter Agent-/Provider-Fehler bleibt `error`. Gestoppte Sessions werden
nicht als Unterbrechung umklassifiziert. Pausierte Sessions und echte offene
Tool-Freigaben bleiben beim Restore erhalten; verwaiste Freigabeanzeigen werden
weiter nach BUG-0048 bereinigt. Lebende tmux-Worker werden übernommen.

## Weiterarbeiten

1. Grund und letzte Nachrichten lesen; möglicherweise bereits geschriebene
   Dateien im Arbeitsverzeichnis prüfen.
2. **Weitermachen** setzt dieselbe native Session nur fort, wenn der Adapter
   diesen Hub-Aufruf ausdrücklich deklariert und eine Provider-ID gespeichert ist.
   Andernfalls erklärt das Banner die fehlende Unterstützung. Ein externer
   Resume-Befehl allein ist keine Hub-Resume-Freigabe.
3. Ohne natives Resume eine **neue Nachricht mit Kontext** senden. Das ist ein
   bewusster neuer Auftrag; eine unbekannte Provider-ID wird dabei als neuer
   Lauf im Verlauf angezeigt. Der Hub erfindet keinen Resume-Erfolg.
4. **Archivieren** beendet die unterbrochene Session und archiviert sie.
   Vorhandene Arbeit bleibt nach den bisherigen Worktree-Schutzregeln erhalten.

Eine vorgemerkte Nachricht bleibt nach einer Unterbrechung gespeichert und
wartet auf den Abschluss einer abgesicherten Fortsetzung. Eine unklare
Zustellung verlangt eine menschliche Entscheidung; kein blindes Restore-Replay.
Alte Adapter-Kontexte können nach Abbruch keine Nachrichten in den neuen Zug
schreiben. Native Fortsetzung und andere Eingaben werden serialisiert.

## API, CLI und automatische Fortsetzung

`POST /api/sessions/:id/resume` mit JSON-Body `{}` ist Mensch/Fleet vorbehalten.
Agenten, Bridge, Display und Companion erhalten 403. Dasselbe gilt für den
bestehenden Steer-Aufruf mit `kind: "resume"`. Fehlende Session: 404; nicht
unterbrochen, nicht deklariert oder fehlende Provider-ID: 422 mit Begründung.
Ein gestarteter, aber fehlgeschlagener Resume wird als `error` sichtbar.

`hubctl sessions` zeigt `interrupted` und zukünftige Statuswerte als Text.
`hubctl tail <id>` zeigt `session.interrupted: <Grund>`; das Journal enthält
`reason`, `since` und `lastTurnId`. Der offene Zug endet mit
`session.turn_end { reason: "interrupted", code: null }`.

Seit [ADR-0076](adr/0076-session-aktivitaet-und-wiederaufnahme.md) ist
`autoResumeInterrupted` standardmäßig `true`. Zusätzlich braucht es
`resume.hub: true`, `resume.ref: "native"`, `resume.auto: true` und eine
bekannte native Session. Codex app-server, Claude, Cursor, Pi, Hermes und die
belegten ACP-Presets Maki/OMP/OpenCode optieren ein. Andere Adapter zeigen
die fehlende Unterstützung ehrlich an.

Nur **neue unbeabsichtigte Unterbrechungen** sind automatisch berechtigt.
Alte unterbrochene Aufträge starten beim Einschalten nicht ungefragt erneut.
Nutzer-Stopp/Pause und Rate-/Kontingentlimits werden nicht wiederholt.
Explizit erkannte Netzwerk-/Serverfehler gelten als technische Unterbrechung;
andere Providerfehler verlangen eine Entscheidung. Der vorhandene Heartbeat und die Eingabeserialisierung
übernehmen die Kontrolle; keine zusätzliche Cron-Datei pro Session.
Die Fortsetzung bleibt im selben Arbeitsverzeichnis und nativen Verlauf.
Nach drei Wiederanläufen ohne erfolgreichen Zugabschluss oder einem
fehlgeschlagenen Start verlangt das Banner eine Entscheidung: **Abbrechen**
oder **An andere Session übergeben**. Der Status ist `interrupted`/`error`.

## Hintergrundarbeit und Nachrichtenannahme

Strukturierte Tool-/Subagent-Aktivitäten halten die Session nach Ende des
Hauptzugs auf `working`. Ein persistenter, lediglich bereiter Provider zählt
nicht als Arbeit. Die Aktivitäten werden journalisiert und nach Neustart
wiederhergestellt. Alte Prozessgenerationen dürfen keine neuen Zustände ändern.
ACP übernimmt überlebende Turns, statt sie bei jedem Hub-Neustart abzubrechen.

Externe Jobs müssen sich ausdrücklich melden. Mit vorhandenem Geräte-/Hub-
Zugang (wie für die übrigen hubctl-Befehle):

```bash
node apps/hubctl/src/cli.ts activity "$ANCIENTVOID_SESSION_ID" gate run -- npm run gate
```

Der Wrapper registriert Start/Ende und meldet alle 20 s einen Heartbeat.
Ohne Meldung für 90 s wird die Arbeit als unklar/fehlgeschlagen sichtbar,
nicht als Erfolg. Eine Wiederaufnahme bei unklarer externer Arbeit wird
angehalten, damit kein zweiter Job entsteht. Beliebige unregistrierte
Prozesse oder Behauptungen in Assistant-Text sind keine verlässliche Quelle.

Adapter ohne echte Live-Eingabe verwenden die persistente Hub-Queue statt
eines flüchtigen Adapterpuffers. Nachrichten bleiben bis zum bestätigten Ack
erhalten. Ein Crash/Timeout mit unbekannter Annahme wird als „Annahme unklar“
angezeigt; diese Nachricht wird nicht automatisch erneut gesendet. Verlauf
prüfen, gegebenenfalls streichen oder die Arbeit übergeben.

## Nachweise

- `packages/core/test/modules/sessions/interrupted-session.integration.test.ts`:
  Worker-Ausfall (kurzlebig/persistent), Fehlergrenze, K7-Restore < 3 s,
  offene Tool-Freigaben, unterbrochener Journal-Abschluss, geplante Pause,
  Idempotenz, Policy, Resume-Fehler, Transport-Aufräumen,
  Digest-Grenze und Auto-Resume-Opt-in.
- `apps/hub/test/modules/approvals/policy.test.ts`: beide HTTP-Eingänge.
- `apps/hubctl/test/interrupted.integration.test.ts`: echte CLI-Ausführung
  gegen lokalen HTTP-Testserver, einschließlich unbekanntem Status.
- `e2e/specs/interrupted-session.spec.ts`: echter Hub mit Dummy-Testadapter
  und deterministischem Worker-Verlust, Mobile/Desktop, dreifach geprüft.
- [E2E-Gate](testing-e2e.md), [ADR-0044](adr/0044-interrupted-sessions-status.md).

Auch nach mehreren Fortsetzungen unterscheidet Recovery die aktuelle
Laufgeneration von früheren abgeschlossenen Unterbrechungen. Beim neuen Start
werden alte Kontexte abgebrochen und deren Worker-Zähler verworfen.
Archivieren übernimmt den auslösenden Akteur in das Stop-Audit.
