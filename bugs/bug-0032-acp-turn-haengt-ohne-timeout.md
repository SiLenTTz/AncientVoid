---
id: BUG-0032
slug: acp-turn-haengt-ohne-timeout
status: done
severity: S1
area: adapters
instance: dev
commit: "3dbc56c"
forge: "!124"
epic: "P7"
created: 2026-09-26
reporter: jan
---

# BUG-0032 — ACP-Zug kann endlos hängen: kein Turn-Timeout, Herzschlag blind

## Gesehen

Eine opencode-Session über `@uacc/adapter-acp` (preset `opencode`) blieb
26 h im Status `working` stecken, ohne dass der Hub es bemerkte oder
sich erholen konnte; weitere Prompts wurden abgelehnt.

## Erwartet

Ein Zug, dessen Agent auf `session/prompt` nicht mehr antwortet, wird
vom Hub nach einer konfigurierbaren Stummszeit abgebrochen (`session/cancel`),
laut als `provider.error` sichtbar und die Session wird wieder `idle`.

## Repro

Voraussetzung: Hub mit Adapter `{"module": "@uacc/adapter-acp", "preset": "opencode"}`,
Agent, dessen Tool-Aufruf (hier: `task`-Subagenten) nie zurückkommt.

Live beobachtet (Session `6f03a88e-e411-4e77-a416-a84425a4c7ca`, 2026-09-25):

1. Prompt „Den aktuellen Stand des UACC-Hubs bewerten …" gesendet.
2. Agent rief 21:40–22:06 Tools auf, zuletzt drei `task`-Subagenten
   (`tool_call … status: in_progress`), die nie beendet wurden.
3. Um 22:16 und 22:21 zweimal „Wo hängst du? Warum kommt keine Antwort?"
   über die PWA gesendet.

**Ergebnis nach Schritt 3:** Prompts landen als `user`+`session.steer`
im EventStore, der Adapter lehnt ab („der Zug läuft noch — erst anhalten
oder abwarten", `packages/adapters/acp/src/index.ts:334`). Die Session
blieb bis zum manuellen Park am 26.09. 11:19 auf `working` (26 h);
`status()` meldete die ganze Zeit `healthy`, weil sie nur die
Prozess-Lebendigkeit prüft (`index.ts:348-352`).

**Häufigkeit:** immer, wenn der Agent verstummt (einmalig beobachtet,
Mechanismus deterministisch)

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | lokal (`127.0.0.1:7373`) |
| Commit | `3dbc56c` |
| Node-Version | 26.7.0 |
| Adapter | acp (preset `opencode`, `opencode acp`) |
| Repro-Weg | PWA + hubctl |

## Logs

`data/workers/uacc-6f03a88e-….log` (Auszug, letzte Meldungen):

```text
22:06:19 {"method":"session/update","params":{"update":{"sessionUpdate":"tool_call","toolCallId":"call_ff20f889…","title":"task","status":"pending"}}}
22:06:19 {"method":"session/update","params":{"update":{"sessionUpdate":"tool_call_update","status":"in_progress","title":"Epics-Exit-Kriterien scannen"}}}
… (zwei weitere task-Subagenten) — danach 26 h keine Zeile mehr
```

Nach manuellem Park (`session/cancel`) kam sofort:

```text
11:19:18 #30-32 tool_result  Task cancelled
11:19:19 #33 system  opencode: Zug beendet (cancelled)
```

## Tests

| Ring | Befund / Datei | Stand vor dem Fix |
|---|---|---|
| Unit | `packages/adapters/acp/test/adapter.test.ts` | grün, deckt hängenden Zug nicht ab |
| Contract | `packages/adapters/acp/test/contract.test.ts` | grün, ohne Timeout-Szenario |

Ohne Fix rot müsste: ein Adapter-Test, dessen Stand-in-Agent auf
`session/prompt` nicht antwortet — erwartet `provider.error` + Turn-Ende +
wieder freie Session; heute läuft er in den Vitest-Timeout (busy bleibt
true). Vorschlag: `packages/adapters/acp/test/adapter.test.ts` erweitern.

## Eingrenzung

`packages/adapters/acp/src/index.ts:267` — `conn.request("session/prompt", …)`
ohne `timeoutMs` (`@uacc/adapter-jsonrpc` default 0 = unbegrenzt). Dazu:
`index.ts:348-352` (`status()` ignoriert `busy`), `index.ts:334`
(Steer-Abfuhr während busy). Ein absolutes Request-Timeout allein wäre
falsch (legitim lange Züge mit Tool-Aktivität); nötig ist eine
Inaktivitäts-Wachhund, den jede Agent-Meldung (auch
`session/request_permission`) zurücksetzt.

## Handoff

- [ ] Datei im Index [`README.md`](README.md)
- [ ] GitLab-Issue angelegt (Link oben)
- [ ] `bugfix` oder offen lassen

## Fix (verifiziert 2026-10-03, Ralph mobile-hub-bugfrei)

- Fix: `407f9fb` (^ B acp: stumme Züge nach Frist abbrechen (BUG-0032),
  MR !124) — Inaktivitäts-Wachhund `stuckTurnMs` (Default 30 min):
  stummer Zug wird per `session/cancel` abgebrochen, `provider.error`
  gelautet, Session `idle`; ignoriert der Agent auch den Cancel,
  erzwungenes Zugende + Queue-Drain. Pending-Permission entwaffnet den
  Hund (Warten auf das Handy ist kein Stuck). Config:
  `packages/adapters/acp/src/index.ts` (`stuckTurnMs`, Z. 80–83,
  `armStuckWatch`/`unstickTurn` Z. 185–215).
- Verifikation: `npx vitest run packages/adapters/acp/test/adapter.test.ts`
  → 25/25 grün, inkl. 3 BUG-0032-Szenarien (stummer Zug abgebrochen,
  Cancel-ignorierender Agent erzwungen beendet, Permission entwaffnet).
