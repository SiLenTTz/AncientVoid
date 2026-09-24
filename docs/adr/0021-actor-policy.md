# ADR-0021 — Eine Policy nach Akteur für jede Route

**Status:** akzeptiert · **Betrifft:** EPIC-P7 T7.4, `packages/contracts/src/approvals/policy.ts`,
`apps/hub/src/platform/policy.ts`, `apps/gateway-mcp/src/operations.ts`, `hubctl token issue --agent`

## Kontext

Freigaben galten nur für einzelne Aktionen (Hub-Prompt, Budget, Tool). Wer
eine Anfrage stellte, spielte keine Rolle: Ein MCP-Agent mit Geräte-Token hätte
alles gedurft, was ein Mensch darf. Deshalb blieben Start, Stop und Park im
MCP-Gateway gesperrt (Audit G07).

## Entscheidung

1. **Akteur aus dem Token-Label:** `agent:<name>` (neu, `hubctl token issue
   <name> --agent`), `bridge:<session>`, `fleet:<home>`, sonst Mensch.
2. **Eine Tabelle** `POLICY[operation][akteur]` → `allow` | `approve` |
   `deny`, geprüft in einem `preHandler` für jede `/api`-Route. Nicht
   zugeordnete Schreibzugriffe gelten für Nicht-Menschen als `deny`.
3. **Agenten fragen, Menschen entscheiden:** Jeder Schreibzugriff eines
   Agenten (Session starten, Prompt, Park, Stop, Budget) wird zu einer
   Freigabe; die freigegebene Operation läuft einmal (ADR-0019).
   Entscheiden, Übernehmen, Archivieren, Tokens und Flotte sind für Agenten
   gesperrt. Der Not-Stopp bleibt für Menschen sofort.
4. **Brücke:** darf ausschließlich `tools.ask` (fragen und warten).
5. Invarianten als Test (`contracts/test/approvals/policy.test.ts`): Ein
   Agent hat nie `allow` für einen Schreibzugriff; nur Menschen oder ein
   Heim-Hub in ihrem Auftrag entscheiden Freigaben.

## Konsequenzen

- Das MCP-Gateway bietet `sessions.create`, `sessions.stop` und
  `sessions.park`; Antwort 202 „pending approval <id>“. Weiterhin genau drei
  Meta-Tools; K4 jetzt mit echten Tokenizern (o200k_base 280, cl100k_base 274).
- Bestehende Geräte-Tokens bleiben menschlich. Ein Gateway mit altem
  Geräte-Token muss ein Agenten-Token bekommen.
