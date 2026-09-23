# ADR-0019 — Freigegebene Aktionen überstehen einen Hub-Absturz

**Status:** akzeptiert · **Betrifft:** EPIC-P7 T7.3, `packages/contracts/src/operation.ts`,
`packages/core/src/{operations,sessionmanager,approvals}.ts`, Migration 12

## Kontext

Ein Prompt oder eine Budget-Erhöhung, die auf Freigabe wartet, lag bis P7 nur
im RAM (`pendingSteers`, `pendingBudgetTopUps`). Starb der Hub, stand die
Freigabe noch in SQLite, aber es gab nichts mehr, was sie auslösen konnte
(Audit G07). Außerdem prüfte niemand, ob das Ausgeführte dem Freigegebenen
entsprach.

## Entscheidung

1. **Operation neben der Freigabe.** Jede freigabepflichtige Aktion wird als
   `operations`-Zeile mit unveränderlichen Argumenten (`payload`), deren
   SHA-256 (`payload_hash`, sortierte Schlüssel), Eingabe-Revision und
   Akteur gespeichert. Die Freigabe (ADR-0007) bleibt die Entscheidung; ihr
   Hash steht auch in `approvals.payload_hash` und geht in die HMAC-Signatur
   der Entscheidung ein.
2. **Zustände:** `pending` → `rejected` | `timed_out` | `dispatching` →
   `done` | `failed`; `dispatching` beim Neustart → `uncertain`. Jeder
   Übergang ist ein bedingtes `UPDATE … WHERE state IN (…)`. Deshalb kann
   nur ein Aufrufer eine Operation auf `dispatching` setzen: Eine
   Freigabe läuft höchstens einmal.
3. **Vor dem Ausführen** wird der Hash erneut berechnet und mit dem
   freigegebenen verglichen. Bei Abweichung läuft nichts, die Session bekommt
   `operation.rejected_changed`.
4. **Nach einem Neustart** (`recoverAll`):
   - noch unentschieden: bleibt `pending` und kann normal entschieden werden;
   - freigegeben, aber nie gestartet: läuft jetzt, einmal (`operation.resumed`);
   - inzwischen abgelehnt oder abgelaufen: wird so vermerkt;
   - lief gerade: `uncertain`, mit Warnung (`operation.uncertain`) und
     **ohne** Wiederholung. Ob der Provider schon gehandelt hat, weiß der
     Hub nicht.

## Konsequenzen

- `GET /api/approvals` zeigt je Freigabe, was daraus wurde; die PWA schreibt
  „ausgeführt“, „nicht ausgeführt“ oder „Ausführung ungewiss“.
- Tool-Freigaben aus T7.2 (`tool.permission`) nutzen denselben Store.
- `erasableSyntaxOnly` im TypeScript-Setup: Syntax, die Nodes
  Type-Stripping nicht kann (Parameter-Properties, `enum`), fällt schon
  beim Typecheck auf statt erst zur Laufzeit.
