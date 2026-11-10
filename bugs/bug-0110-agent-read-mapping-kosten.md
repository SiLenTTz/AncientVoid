---
id: BUG-0110
slug: agent-read-mapping-kosten
status: open
severity: S4
area: server
instance: dev
commit: "7d0ab0b"
forge: ""
epic: "EPIC-P7 T7.4 / EPIC-P1.5 §3.4 / EPIC-P3 §3 (Learning-Loop)"
created: 2026-11-10
reporter: "Sicherheitsaudit (pi)"
---

# BUG-0110 — Agent-Token löst Kosten-/Schreib-Endpunkte ohne Approval aus

## Gesehen

`POST /api/prompt-enhance`, `POST /api/prompt-recommendation` und
`POST /api/prompt-optimizer/feedback` sind in der Policy-Tabelle
(`apps/hub/src/platform/policy.ts`, `operationOf`) als `read` gemappt — und
`read` ist für `agent:*` auf `allow` gesetzt. Diese drei Endpunkte sind aber
keine reinen Lesevorgänge: enhance startet einen echten, kostenpflichtigen
CLI-Einmalauf ruf (im Code nachgemessen: ~6,6 s und $0,065 pro claude-Aufruf;
Timeouts bis 120 s), feedback schreibt persistent in die
Learning-JSONL. Ein Agent-Token kann damit ohne Approval und ohne jede
Ratenbegrenzung Geld ausgeben und die Learning-Daten schreiben. Zum
Vergleich: der MCP-Gateway (der Hauptinhaber von Agent-Tokens) exportiert
`prompt-enhance` bewusst nicht als Tool — die REST-Tür steht aber allen
Agent-Token-Inhabern offen.

## Erwartet

T7.4 („An agent requests; a human decides“): Alles, was Geld kostet,
Prozesse startet oder persistiert schreibt, liegt für Agents auf
`approve`/`deny` — nicht auf `allow`. Und wenn `allow` gewollt ist
(P1.5-Kommentar: enhance ist „never automatic, only on explicit request“),
dann nicht unbegrenzt und ohne Ratenbegrenzung (die einzige Route im System
mit Ratenbegrenzung ist Fleet-Pairing, 10/min).

## Repro

Voraussetzung: laufende Testinstanz (frische DB, `127.0.0.1:7979`), ein
Agent-Token und ein normales Token; opencode-CLI installiert (Fallback-Pfad
`enhanceFlavorFor` → `enhanceViaOpencode` greift für jeden ungemappten
Adapter, hier Adapter „dummy“).

1. `curl -X POST -H "Authorization: Bearer <agent-token>" -d '{"label":"x"}' http://127.0.0.1:7979/api/tokens` → **403** (Agent-Identität greift korrekt — Vergleichspunkt).
2. `curl -X POST -H "Authorization: Bearer <agent-token>" -d '{"adapter":"dummy","text":"audit probe","project":"/tmp"}' http://127.0.0.1:7979/api/prompt-enhance` → **200 nach 9,4 s** mit vollständigem Rewrite — ein echter CLI-Prozess lief durch, ohne Approval.
3. `curl -X POST -H "Authorization: Bearer <agent-token>" -d '{"adapter":"dummy","project":"/tmp","original":"audit","enhanced":"audit","decision":"accepted","latencyMs":1}' http://127.0.0.1:7979/api/prompt-optimizer/feedback` → **200**, die Zeile steht in `data/prompt-optimizer-feedback.jsonl`.

**Ergebnis nach Schritt 3:** Agent handelt (Kosten + persistenter Schreib)
auf Class-`read`-Routing ohne Approval; dieselbe Identität darf bei
`tokens.manage` nicht. **Häufigkeit:** immer.

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | lokal (Testinstanz `127.0.0.1:7979`, frische DB) |
| Commit | `7d0ab0b` |
| Node-Version | v26.7.0 |
| Adapter | dummy (über opencode-Fallback; keine Registry-Regel nötig) |
| Repro-Weg | API direkt (hubctl deckt enhance/feedback nicht ab); über PWA nur mit Mensch-Token darstellbar |

## Logs

Quelle: Hub-Log der Testinstanz (Auszug).

```text
{"ts":"2026-11-10T00:12:14.283Z",...,"reqId":"req-4","req":{"method":"POST","url":"/api/prompt-enhance",...},"msg":"incoming request"}
{"ts":"2026-11-10T00:12:23.654Z",...,"reqId":"req-4","res":{"statusCode":200},"responseTime":9370.97,...,"msg":"request completed"}
{"ts":"2026-11-10T00:24:29.335Z",...,"msg":"request completed"}   ← POST feedback (agent) → 200, JSONL-Zeile geschrieben
```

JSONL-Auszug (ohne Secrets): Zeile mit `"adapter":"dummy","decision":"accepted"` von 00:24:29Z.

## Tests

| Ring | Befehl / Datei | Stand vor dem Fix |
|---|---|---|
| Contract | `packages/contracts/test/approvals/policy.test.ts` (Tabelle selbst) | grün — das Problem steckt in der Tabelle/Zuordnung, nicht in ihrer Umsetzung |
| Integration | vorzuschlagen: `apps/hub/test/policy-agent-cost-actions.integration.test.ts` — Agent-Token auf `POST /api/prompt-optimizer/feedback` erwartet Approval/403, nicht 200 | nicht vorhanden; müsste ohne Fix rot sein |

## Eingrenzung

`apps/hub/src/platform/policy.ts` (`operationOf`: Zuordnung
`prompt-enhance|prompt-recommendation|prompt-optimizer/feedback → read`) in
der Kombination mit `packages/contracts/src/approvals/policy.ts`
(`read: agent allow`) und `apps/hub/src/modules/prompts/enhance.ts`
(Prozessstart + gemessene Kosten). Ratenbegrenzung fehlt systemweit außer
bei Fleet-Pairing.

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [ ] GitLab-Issue angelegt (Link oben)
- [ ] `bugfix` oder offen lassen
