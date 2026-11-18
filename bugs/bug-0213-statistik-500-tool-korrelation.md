---
id: BUG-0213
slug: statistik-500-tool-korrelation
status: done
severity: S2
area: core
instance: dev
commit: "1ca58f3e"
forge: ""
epic: "EPIC-P56 (Statistik), K5/K7 (Ursache)"
created: 2026-11-18
reporter: Nutzer („Terminal Server Error" in der Statistik, 18.11.2026)
---

# BUG-0213 — /api/statistics 500 „Tool-Ergebnis ohne zusammengehörigen Aufruf": Statistik-Seite komplett lahm

## Gesehen

Die Statistik-Seite der PWA zeigt nur noch „Statistik nicht erreichbar —
Tool-Ergebnis ohne zusammengehörigen Aufruf."; `GET /api/statistics`
antwortet 500. Der Nutzer meldete das als „Terminal Server Error" (der
Fehlertext der Seite ist der server-seitige Fehler).

## Erwartet

Die Statistik-Seite antwortet auch mit Journals, die ausgelagerte
(K5-truncated) Tool-Ergebnisse oder Resume-Replay-Blöcke enthalten; nicht
zuordenbare Ergebnisse werden gezählt (unbelegter Tool-Name,
Fehlerstatus unbekannt), nicht weggeworfen und beenden nicht den Rollup.

## Repro

Live (Hub des Nutzers, 18.11.2026): Handy öffnet `#/statistik` → 500.
Journal-Befund: 128 Sessions mit mindestens einem `tool_result`, dessen
Payload der EventStore ausgelagert hat — Zeile enthält dann nur
`{truncated: true, bytes, preview}`, die `toolUseId` steht im Blob; eine
Session (f8f91d2e…) zusätzlich mit Replay-Block (63 doppelte Call-Ids,
seq monoton 1..11554).

1. Hub mit Statistik-Dienst, Dummy-Session bis `idle` warten.
2. Zwei Zeilen ans Journal anhängen: `tool_use` (id `toolu_k5`) und
   `tool_result` mit `payload: {truncated: true, …}` (K5-Form).
3. `GET /api/statistics`.

**Ergebnis nach Schritt 3:** vor dem Fix 500 mit „Tool-Ergebnis ohne
zusammengehörigen Aufruf." (`deriveToolCallFacts`), nach dem Fix 200 mit
dem nicht zuordenbaren Ergebnis in der `tool: null`-Zeile.

**Häufigkeit:** immer, sobald eine Session der Instanz ein
ausgelagertes Tool-Ergebnis enthält (bei placer Über-4-KB-Ergebnissen
der Regelfall).

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | lokal (`127.0.0.1:7373`, Journal-Scan über `data/sessions/`) |
| Commit | `1ca58f3e` (live), Ursache seit EPIC-P56 (T56.1b) |
| Node-Version | 26 |
| Adapter | alle mit großen Tool-Ergebnissen (u. a. opencode, claude) |
| Repro-Weg | Route-Test / PWA |

## Logs

```text
{"level":50,"req":{"method":"GET","url":"/api/statistics"},
 "res":{"statusCode":500},
 "err":{"message":"Tool-Ergebnis ohne zusammengehörigen Aufruf.",
        "stack":"at deriveToolCallFacts (packages/core/src/modules/statistics/tool-statistics.ts:50:48)
                 at StatisticsRollup.run (packages/core/src/modules/statistics/rollup.ts:84:171)"}}
```

## Tests

| Ring | Befund / Datei | Stand vor dem Fix |
|---|---|---|
| Unit | `packages/core/test/modules/statistics/tool-statistics.test.ts` | war grün — pinnte das Wegwerfen-Verhalten („lehnt … ab") fest und überdeckte damit den Defekt |
| Route | `apps/hub/test/modules/statistics/routes.test.ts` | neu: „übersteht K5-ausgelagerte Tool-Ergebnisse im Journal (BUG-0213)" — **rot** (500), nach Fix grün |

## Eingrenzung

`packages/core/src/modules/statistics/tool-statistics.ts:35-58` —
`deriveToolCallFacts` warf bei (a) `tool_result` ohne inline-Id
(K5-Auslagerung, EventStore `append` ersetzt den Payload ab 4 KB), (b)
Ergebnis ohne Aufruf, (c) doppelte Call-Id, (d) doppeltes Ergebnis. Der
Wurf lief durch `StatisticsRollup.run` bis in den Route-Handler — eine
einzige betroffene Session legt die ganze Seite lahm. (c)/(d) sind
legitime Journal-Inhalte nach Resume (Replay-Blöcke, K7).

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [ ] GitHub-Issue angelegt (folgt mit dem PR)
- [x] `bugfix` — Ableitung zählt statt zu werfen: Replay-Doppelungen
      idempotent (erste Call-Id gewinnt), Ergebnisse ohne Zuordnung als
      Fakt `{tool: null, result: <Status>}`; Contracts unverändert.
