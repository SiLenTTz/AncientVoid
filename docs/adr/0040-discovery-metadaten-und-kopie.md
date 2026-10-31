# ADR-0040 — Entdeckung zeigt Titel und letzte Nachricht; Übernahme als Kopie

**Status:** akzeptiert · **Betrifft:** `packages/contracts/src/sessions/identity.ts` (`DiscoveredSession`), `…/session.ts` (`SessionSpec`),
`packages/core/src/modules/discovery/`, `SessionManager.discover/create`, `packages/adapters/claude/`, `GET /api/discovery`,
PWA `features/discovery/`, EPIC-P22

## Kontext
„Gefunden“ listete nur Adapter, Status und die rohe Provider-ID. Wer eine Session aufgreifen wollte (z. B. die laufende Claude-Session
am AncientVoid), konnte sie nicht erkennen. Zwei Fehler kamen dazu, beide am 2026-10-27 live gesehen:
1. Übernahme **ohne Prompt** startete `claude -p "" --resume <id>`. Die CLI sucht dann eine offene Tool-Freigabe und endet mit
   „No deferred tool marker found in the resumed session“ — die Hub-Session stand sofort auf `error` (zwei Versuche, gleiche Meldung).
2. Eine Session, die in einem Terminal noch offen ist, hätte das Transkript mit dem Hub-Prozess geteilt (zwei Schreiber).

## Entscheidung
1. **Additive Anzeige-Felder** an `DiscoveredSession`: `title`, `preview` (≤ 160 Zeichen), `live`. Alle optional; fehlt ein Feld, kann die Quelle es
   nicht sagen (R9.7). Sie sind nie Identität; Dedupe-Schlüssel bleibt Host + Adapter + native ID (ADR-0011).
2. **Claude:** `ai-title` und `last-prompt` aus dem Transkript. Gelesen werden nur ein Kopf- (96 KB) und ein Endfenster (256 KB), Ergebnis je
   (Pfad, mtime, Größe) gemerkt. Ohne `ai-title` gilt der erste echte Prompt (CLI-Hüllen wie `<command-…>`, Meta-Zeilen, Tool-Ergebnisse zählen nicht).
   **opencode:** Spalte `title` (der Standardtitel „New session – …“ zählt nicht). **Hub-Records:** `title` und `lastActivity`.
   Beim Zusammenführen behält der Hub-Eintrag seine Felder und leiht fehlende vom externen Fund.
3. **`live`:** Transkript in den letzten 90 s beschrieben ⇒ vermutlich offen in einem anderen Harness. Hub-Sessions: `working`/`starting`.
4. **Suche vor dem Paging:** `GET /api/discovery?q=…&adapter=…` filtert (alle Wörter, ohne Groß/Klein) in Titel, Vorschau, Projekt, Adapter, IDs
   und paginiert danach — ein Treffer auf Seite 9 geht nicht verloren.
5. **Übernahme als Kopie:** `SessionSpec.adoptFork` → Adapter-Arg `forkSession` → `claude --resume <id> --fork-session` **nur im ersten Zug**
   (danach hat die Kopie ihre eigene ID, der Adapter übernimmt sie aus dem Init-Event). `SessionRecord.fork` wird gesetzt.
   Die PWA bietet bei `live` nur „Als Kopie fortsetzen“ an, sonst „Fortsetzen“ und „Als Kopie“. `SessionSpec.title` übernimmt den Titel in die Übersicht.
6. **Übernahme ohne Prompt startet keinen Prozess** (Claude-Adapter, wie `recover()`): Verlauf importieren, Status `idle`, der nächste Prompt setzt fort.
7. **Transkript-Import:** die Buchhaltungszeilen von Claude (`ai-title`, `last-prompt`, `mode`, `permission-mode`, `atis-latch`, `pr-link`, `cost-state`,
   `queue-operation`, `file-history-snapshot`, `api-request*`) sind eine **benannte Liste** ohne Event; jeder andere unbekannte Typ bleibt laut (Regel 6).
   Anhang-Hinweise verbrauchen das 200-Event-Fenster nicht mehr.

## Folgen und Grenzen
- Contract: nur optionale Felder; alte Clients und Quellen bleiben gültig.
- Eine Kopie, die vor ihrem ersten Prompt einen Hub-Neustart erlebt, wird nativ mit der **Original-ID** fortgesetzt (der Fork-Wunsch steht nur im Speicher).
  Selten und folgenlos, solange das Original nicht mehr offen ist; wer es genau braucht, schickt vor dem Neustart den ersten Prompt.
- Codex, pi, hermes, aider und copilot erscheinen weiter nur als Hub-Sessions (mit Titel); externe Scanner für deren Speicher gehören in ein eigenes Epic,
  weil Übernahme dort noch keine Resume-Argumente kennt (ADR-0036 deklariert Resume nur mit Beleg).
- Nicht belegt: ob eine Session mit **offener Tool-Ausführung am Transkriptende** nativ fortsetzbar ist. Das ist am 2026-10-28 nicht gegen die echte CLI
  geprüft worden (Schreiben in `~/.claude` war für Experimente nicht erlaubt); die Kopie-Option ist der dokumentierte Weg, das Original nicht zu berühren.
