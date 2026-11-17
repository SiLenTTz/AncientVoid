---
id: BUG-0202
slug: cursor-interaction-query-fehlt-im-chat
status: open
severity: S2
area: adapters
instance: dev
commit: "918a57f4"
forge: "https://github.com/securesight-ai/AncientVoid/issues/116"
epic: ""
created: 2026-11-17
reporter: silenttz
---

# BUG-0202 — Cursor-Fragen/Pläne nur im Verlauf, nicht im Chat

## Gesehen

In einer Cursor-Session erscheint eine vom Agenten gestellte
Architektur-Entscheidung (Plan-/Fragen-UI) **nur** im detaillierten Verlauf
als Systemzeile `cursor: unbehandelter stream-json-Typ "interaction_query"`.
Im Chat-Tab fehlt die Frage — der Nutzer sieht die Optionen nicht und muss
nachfragen. Dieselbe Session hat außerdem **172** Systemzeilen
`unbehandelter stream-json-Typ "tool_call"` und **null** `tool_use`/`tool_result`-Events.

## Erwartet

Nutzer-sichtbare Cursor-Interaktionen (`interaction_query`: Plan-Bestätigung,
Auswahlfragen) landen als Chat-Inhalt (z. B. `assistant`-Text oder ein
eigenes, in `showInChat` sichtbares Ereignis). Werkzeugaufrufe im neuen
`tool_call`-Stream erscheinen als `tool_use`/`tool_result` (Arbeitsschritte
im Chat), nicht nur als `cursor.unhandled` im Verlauf.

## Repro

Voraussetzung: Hub mit Adapter `cursor`, Session am Gerät (PWA-Chat-Tab
„Lesen“ / Dock „Chat“). Agent nutzt Cursor-Planmodus oder eine
Auswahlfrage (CreatePlan / SwitchMode / AskQuestion-Äquivalent).

1. Session starten, Agent eine Aufgabe geben, die eine Architekturwahl
   erzwingt (oder Planmodus).
2. Warten, bis der Agent eine Entscheidung/Plan-UI sendet.
3. Chat-Tab prüfen; danach Verlauf-Tab (Überwachen/Debuggen).

**Ergebnis nach Schritt 3:** Chat ohne die Frage; Verlauf zeigt
`cursor.unhandled` mit `type: "interaction_query"` (hier seq 173/174 und
185/186, 2026-11-17T19:09:18Z bzw. 19:10:44Z). Assistant-Text bricht vorher
mit „Eine Entscheidung verändert den Plan stark:“ ab — die Optionen folgen
nur im unbehandelten Stream-Ereignis.

**Häufigkeit:** immer, sobald Cursor `interaction_query` / `tool_call`
emittiert (neues stream-json gegenüber dem Claude-Code-Shape).

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | lokal (`127.0.0.1:7373`) |
| Commit | `918a57f4` (Worktree; Symptom unabhängig vom Doku-Commit) |
| Node-Version | v26.7.0 |
| Adapter | cursor |
| Repro-Weg | PWA (gesehen) + `events.jsonl` der Session |

## Logs

Auszug Session-Events (keine Secrets):

```text
seq=173 ts=2026-11-17T19:09:18.547Z
  system  summary: cursor: unbehandelter stream-json-Typ "interaction_query"
  payload: { kind: "cursor.unhandled", type: "interaction_query" }

seq=183 assistant  text endet mit: "…Eine Entscheidung verändert den Plan stark:"
  (Optionen fehlen im payload.text)

seq=185/186  erneut interaction_query → cursor.unhandled

Zählung derselben Session:
  cursor.unhandled tool_call: 172
  cursor.unhandled interaction_query: 4
  tool_use: 0
  tool_result: 0
```

Rohform im Worker-Log (Cursor stream-json, gekürzt):
`{"type":"tool_call","subtype":"started"|"completed", "tool_call":{…}}` —
nicht das bisher gemappte `assistant.message.content[].type=tool_use`.

## Tests

| Ring | Befehl / Datei | Stand vor dem Fix |
|---|---|---|
| Unit | `packages/adapters/cursor/test/normalize.test.ts` | grün, kennt `interaction_query`/`tool_call` nicht |
| Contract (`adapter-testkit`) | — | — |

Ohne Fix müsste ein neuer Case in `normalize.test.ts` rot sein:
Fixture-Zeile `type: "interaction_query"` und `type: "tool_call"` /
`subtype: "started"|"completed"` → sichtbare Chat-Events, kein bloßes
`cursor.unhandled`.

## Eingrenzung

`packages/adapters/cursor/src/normalize.ts` — unbekannte Typen werden ab
Zeile ~129 als `cursor.unhandled` emittiert; Parser erwartet noch das
Claude-Code-Shape (`assistant` + Content-Blöcke `tool_use`). Chat-Filter
(`apps/pwa/src/features/session/event-filter.ts` `showInChat`) zeigt
`cursor.unhandled` bewusst nicht — deshalb „nur Verlauf“.

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [x] GitHub-Issue angelegt (`gh issue create`, URL in `forge:`)
- [ ] offen lassen → später `bugfix` (Cursor-Normalizer auf neues stream-json)
