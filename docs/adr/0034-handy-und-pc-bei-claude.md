# ADR-0034 — Handy und PC bei Claude: was sich synchronisieren lässt und was nicht

**Status:** akzeptiert (Teil 1 umgesetzt, Teil 2 offene Entscheidung) · **Betrifft:** EPIC-P15 T15.4,
Hub `GET /api/sessions/:id/pc`, `discovery.claudeCommand`, PWA

## Kontext

Beobachtung aus dem Betrieb: Eingaben, die am PC in einer Claude-Session gemacht werden, erscheinen im
AncientVoid — Eingaben vom Handy erscheinen am PC nicht. Der Entwurf einer Nachricht dagegen ist
bereits geräteübergreifend synchron (`DraftStore`, Revision und Lease).

Ursache (gegen claude 2.1.288 geprüft): Der Hub liest das Transcript der PC-Session mit (deshalb sind PC-Eingaben
am Handy sichtbar). Eine Eingabe vom Handy führt der Hub als eigenen Prozess `claude -p --resume <id>` aus,
der an dasselbe Transcript anhängt. Die **interaktive** Claude Code am PC liest ihr Transcript im laufenden
Betrieb nicht neu ein und nimmt von außen keine Eingabe an. Das ist eine Eigenschaft der CLI, kein Fehler im Hub.
Ein echter Zwei-Wege-Sync für eine bereits offene PC-Oberfläche ist damit nicht herstellbar.

Die CLI bietet zwei Dinge, die hier helfen:

- `claude agents --json` listet offene Sessions — `interactive` (mit PID) und `background` — mit Session-ID,
  Name und Zustand.
- Hintergrund-Sessions (`claude --bg`, `claude attach <id>`, `claude logs`, `claude stop`): ein Prozess, den
  mehrere Terminals live öffnen können.

## Entscheidung

1. **Teil 1 (umgesetzt):** Der Hub liest `claude agents --json` (kurz gecacht, nur lesend, Befehl über
   `discovery.claudeCommand`) und meldet je Session über `GET /api/sessions/:id/pc`, ob sie am PC offen ist.
   Die App zeigt dann einen Hinweis mit dem passenden Befehl (`claude --resume <id>` bzw. `claude attach <id>`),
   statt den PC veraltet aussehen zu lassen. Fehlt `agents` (ältere CLI), bleibt der Hinweis weg — das ist
   kein Fehler.
2. **Teil 2 (nicht entschieden):** Für echten Live-Sync müssten vom Hub gestartete Claude-Sessions als
   Hintergrund-Sessions laufen. Der PC öffnet sie dann mit `claude attach` und sieht beide Seiten live.
   Das ersetzt den Prozess pro Zug (`claude -p`, Stream-JSON) durch eine andere Ereignisquelle (Transcript
   statt Stream) und berührt Recovery (ADR-0014), Freigabe-Brücke (ADR-0018) und Modus-Wechsel (ADR-0033).
   Es wird erst nach einer Entscheidung des Nutzers geplant.

## Folgen

- Kein Schreibzugriff auf fremde Sessions, kein Eintippen in PC-Terminals.
- Der Name aus `agents --json` ist eine Quelle für Titel (EPIC-P15 T15.5).
- Zusätzlicher Prozessstart (`claude agents --json`, ≤ 3 s gecacht) nur, wenn eine Session-Ansicht offen ist.

## Messlatten

K7 (nichts Neues wird zur State-Quelle: der Hinweis ist abgeleitet), K10 (der Nutzer sieht den Grund).
