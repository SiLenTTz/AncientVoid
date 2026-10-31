---
id: BUG-0065
slug: pi-verlauf-ohne-tools-und-thinking
status: done
severity: S2
area: adapters
instance: prod
commit: "43f43d0"
forge: "https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/20"
epic: "P7"
created: 2026-10-26
reporter: jan
---

# BUG-0065 — pi-Verlauf zeigt nur die Schlussantwort: kein Streaming, keine Tool-Calls, kein Thinking

## Gesehen

Im Verlauf einer pi-Session steht pro Turn genau ein `assistant`-Eintrag. Er
erscheint erst, wenn der Turn endet (hier nach 4–12 Minuten). Tool-Calls,
Tool-Results und Thinking fehlen ganz, und solange der Turn läuft, gibt es
keinen gestreamten Text.

## Erwartet

Der Verlauf zeigt wie bei claude/codex/opencode jeden Thinking-Block
(`thinking`), jeden Tool-Aufruf (`tool_use`) samt Ergebnis (`tool_result`) und
den Antworttext (`assistant`), und zwar während der Turn läuft. Ein unbekannter
Record im pi-Stream wird sichtbar gemeldet und nicht still verworfen (Regel 6).

## Repro

Voraussetzung: Produktiv-Hub (`127.0.0.1:7373`), Adapter `pi` mit dem
konfigurierten Default-Modell `evo-evox2/halogen-qwen3.8-flash-next-…`.

1. In der PWA eine pi-Session starten und eine Aufgabe geben, die Tools
   braucht (Recherche + Commit).
2. Verlauf öffnen, während der Turn läuft.
3. Auf das Turn-Ende warten.

**Ergebnis nach Schritt 2:** kein Eintrag außer dem Prompt.
**Ergebnis nach Schritt 3:** ein `assistant`-Eintrag mit dem Schlusstext, dann
`pi: turn finished`.

**Häufigkeit:** immer, bei jedem pi-Turn.

Belegt an Session `eeb744d9-…`. Ausgewertet wurden der Hub-Event-Store
(`data/sessions/<id>/events.jsonl`) und pis eigene Session-Datei
(`~/.pi/agent/sessions/…/2026-10-26T22-15-10-371Z_….jsonl`), beide nur gelesen.
Die Live-Ansicht in der PWA hat der Nutzer gemeldet. Die Event-Zählung unten
zeigt dasselbe ohne Browser.

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | lokal (`127.0.0.1:7373`), Produktiv-Hub |
| Commit | `43f43d0` |
| Node-Version | v26.7.0 |
| Adapter | pi 0.1.0 (pi coding agent 1.4.0) |
| Repro-Weg | PWA (Nutzer), Event-Store-Auswertung |

## Logs

Hub-Event-Store, Session `eeb744d9-…`, alle Event-Typen gezählt:

```text
user/session.prompt 7 · assistant 7 · system/pi.turn_end 7 · system/session.turn_end 7
(kein thinking, kein tool_use, kein tool_result)
```

Ein Turn als Ausschnitt:

```text
2026-10-26T22:15:09.944Z #31 user      session.prompt  "Der wichtigste Punkt ist …"
2026-10-26T22:21:25.018Z #35 assistant                 "Erledigt — Recherche eingearbeitet und committet …"
2026-10-26T22:21:25.018Z #36 system    pi.turn_end
```

pis eigene Aufzeichnung für dieselbe Zeitspanne (Session-Datei ab 22:15:10),
Inhaltsblöcke gezählt:

```text
assistant/thinking 69 · assistant/toolCall 78 · toolResult 78 · assistant/text 8
letzte usage: totalTokens 66764 (22:40:09)
```

pi hat die Daten also. Der Hub kommt nicht an sie heran.

## Tests

| Ring | Befehl / Datei | Stand vor dem Fix |
|---|---|---|
| Unit | `packages/adapters/pi/test/adapter.test.ts` | grün. Die Tests prüfen nur argv und Modell, `fakeProcess()` liefert kein stdout |
| Contract (`adapter-testkit`) | — | pi läuft nicht durch `runContractTests()` (Kommentar im Test: kein `spawnWorker`-Fake) |
| E2E | `e2e/specs/` | kein pi-Stand-in (claude hat `e2e/support/bin/claude`, T7.8) |

Diese Tests müssten ohne Fix rot sein:

- `packages/adapters/pi/test/normalize.test.ts` (neu): ein aufgezeichneter
  `pi --mode json`-Stream als Fixture (`packages/adapters/pi/test/fixtures/
  tool-use.jsonl`, anonymisiert, secret-gescannt) muss `thinking`, `tool_use`,
  `tool_result` und `assistant` in der richtigen Reihenfolge ergeben.
- `adapter.test.ts`: `fakeProcess()` mit stdout-Chunks. Events müssen vor
  `onExit` ankommen (Streaming), und ein Record, der über Chunk-Grenzen
  geschnitten wird, darf nicht verloren gehen.
- E2E: ein `e2e/support/bin/pi`-Stand-in (analog zu T7.8) und ein Spec, der im
  Verlauf Thinking, Tool-Call und Tool-Result sieht.

## Eingrenzung

Die Ursache liegt im Adapter, nicht im Contract und nicht in der PWA:

- `packages/adapters/pi/src/index.ts:63-75`: `attach()` sammelt stdout in einem
  String und sendet **erst in `onExit`** ein einziges `assistant`-Event mit
  `stdout.trim()`.
- `packages/adapters/pi/src/index.ts:53`: pi läuft im Textmodus (Default
  `--mode text`). Dieser Modus gibt nur die Schlussantwort aus.
- pi 1.4.0 hat `--mode json` mit JSONL-Events (`docs/json.md`): `message_update`
  mit `text_delta`, `thinking_delta` und `toolcall_*`, außerdem
  `tool_execution_start/update/end`, `turn_end` und `usage` je
  `message_update`. Auf der Leitung kommen nur Deltas (wichtig für K5). pis Doku
  sagt ausdrücklich, dass Node `readline` nicht geeignet ist (Unicode-Separatoren),
  der Stream muss also an LF getrennt werden.
- Contract (`packages/contracts/src/sessions/event.ts:14`) kennt `thinking`,
  `tool_use` und `tool_result` schon. Die PWA rendert sie
  (`apps/pwa/src/features/session/EventRow.tsx`). **Kein ADR nötig.**
- Dasselbe Muster (stdout puffern, ein Event bei Exit) haben auch
  `packages/adapters/hermes/src/index.ts:149-205` und
  `packages/adapters/aider/src/index.ts:91-99`. Ob deren CLIs einen
  strukturierten Stream anbieten, ist offen und muss je CLI live geprüft werden.
  Das wären eigene Dateien, nicht Teil dieses Bugs.
- Nebenbefund für die Token-Anzeige: `usage` steht im selben Stream und wird
  heute verworfen (`capabilities().usage: false`).

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [x] GitLab-Issue angelegt (Link oben)
- [ ] `bugfix` oder offen lassen
