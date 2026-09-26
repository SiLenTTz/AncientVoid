---
id: BUG-0033
slug: acp-verlauf-erst-nach-zugende
status: open
severity: S2
area: adapters, pwa
instance: dev
commit: "3dbc56c"
forge: ""
epic: "P7"
created: 2026-09-26
reporter: jan
---

# BUG-0033 — ACP-Verlauf kommt live nie an + Chat-Marker fehlen (ACP vs. CLI-Adapter)

## Gesehen

Während eines laufenden (oder hängenden) opencode-ACP-Zugs zeigt die PWA
keine neuen Verlaufsevents: Assistant-/Thinking-Chunks werden erst beim
nächsten Tool-Call oder Zugende geflusht. Außerdem zeigt der Chat für
ACP-Sessions weder den Modell-Marker noch eine sichtbare
Nicht-zugestellt-Markierung für abgelehnte Prompts.

## Erwartet

Wie beim CLI-Adapter (`adapter-claude`, `adapter-opencode`): Chunks
erscheinen live im Verlauf, während der Agent arbeitet; das gewählte
Modell steht in der Kopfzeile; eine abgelehnte Eingabe ist im Chat als
nicht zugestellt erkennbar.

## Repro

Voraussetzung: Session über `@uacc/adapter-acp` (preset `opencode`),
PWA geöffnet, Tab „Lesen"/Chat.

1. Prompt senden, der eine längere Antwort ohne Tool-Call erzeugt.
2. Während der Agent streamt, den Chat beobachten.

**Ergebnis nach Schritt 2:** keine Events bis der Zug endet —
`UpdateMapper.map()` puffert `agent_message_chunk`/`agent_thought_chunk`
(`packages/adapters/acp/src/normalize.ts:84-94`) und `flush()` läuft nur
bei Tool-Call/Plan/Zugende (`index.ts:270,280`). Im Hänge-Fall
(BUG-0032) kam der letzte Text des Agenten nie an.

3. Während `busy` einen Prompt senden (wird abgelehnt, s. BUG-0032).

**Ergebnis nach Schritt 3:** Die eigene Nachricht erscheint im Chat wie
zugestellt; die Ablehnung steht nur klein unterm Eingabefeld
(`SessionTail.tsx:398-404`). Das `session.steer`-Event (payload
`ok:false`) wird vom Chat-Filter nie gerendert
(`apps/pwa/src/features/session/event-filter.ts:30-41`) und trägt das
Ablehnungs-Detail gar nicht (`session-manager.ts:616`).

4. Kopfzeile einer ACP-Session ansehen.

**Ergebnis nach Schritt 4:** kein Modell-Label — die Suche matcht nur
`opencode.model` (`SessionTail.tsx:416-419`), der ACP-Weg emittiert
`acp.model` (`acp/src/index.ts:260`); `showInChat` kennt `acp.model`
ebenfalls nicht.

**Häufigkeit:** immer

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | lokal (`127.0.0.1:7373`) |
| Commit | `3dbc56c` |
| Node-Version | 26.7.0 |
| Adapter | acp (preset `opencode`) |
| Repro-Weg | PWA |

## Logs

EventStore Session `6f03a88e-…`: nach `#22-24 tool_use task({})`
(22:06) kamen bis zum Park am nächsten Tag keine Assistant-Events mehr,
obwohl der Worker-Log weitere `agent_message_chunk`-Zeilen enthält
(auszugweise in `data/workers/uacc-6f03a88e-….log`).

## Tests

| Ring | Befund / Datei | Stand vor dem Fix |
|---|---|---|
| Unit | `packages/adapters/acp/test/adapter.test.ts` | grün; „messages-not-tokens" testet nur den Flush am Zugende |
| Unit (Filter) | `apps/pwa/src/features/session/event-filter.test.ts` (falls vorhanden) | prüft `opencode.*`-Kinds, nicht `acp.model` |

Ohne Fix rot müsste: ein Adapter-Test, dessen Stand-in-Agent Chunks
streamt, die Zugende-Antwort aber verzögert — erwartet ein
`assistant`-Event vor dem Zugende. Plus ein Filter-/Rendering-Test für
`acp.model` und `session.steer {ok:false}`. Vorschlag:
`packages/adapters/acp/test/adapter.test.ts`, PWA-Unit/E2E.

## Eingrenzung

- Puffern: `packages/adapters/acp/src/normalize.ts:84-94` + Flush-Punkte
  `index.ts:270,280` — es fehlt ein periodischer Live-Flush während
  `busy`.
- Modell-Marker: `apps/pwa/src/features/session/SessionTail.tsx:416-419`
  und `event-filter.ts:35` kennen nur `opencode.model`.
- Nicht-zugestellt: `packages/core/src/modules/sessions/session-manager.ts:616`
  (Event ohne `detail`) und Chat-Filter `event-filter.ts:30-41`.

## Handoff

- [ ] Datei im Index [`README.md`](README.md)
- [ ] GitLab-Issue angelegt (Link oben)
- [ ] `bugfix` oder offen lassen
