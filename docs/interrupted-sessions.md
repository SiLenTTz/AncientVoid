# Unterbrochene Sessions (P27 / ADR-0044)

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
wartet auf menschliches Fortsetzen; der Hub startet sie nicht beim Restore.
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

`autoResumeInterrupted` ist im Hub standardmäßig `false`. Zusätzlich braucht
es `resume.hub: true`, `resume.ref: "native"` und `resume.auto: true` im Adapter.
P27 aktiviert dies ausschließlich im synthetischen Dummy-Testmodus
(`hubResume:true`), mit E2E-Beleg. Produktive Adapter erhalten dadurch keine
neue automatische Startberechtigung. Ein Provider-Token-Handle bleibt intern;
der Hub interpretiert weder Handle-Inhalte noch Agent-Output als Befehle.

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
