# ADR-0096 — Wissensquellen: der Hub ist generischer MCP-Client, die Quelle ist Konfiguration

**Status:** Vorgeschlagen (19.11.2026) — Nutzer-Review ist das Gate aus EPIC-P74 T74.1.

## Lage

EPIC-P74 will Second-Brain-/Knowledge-Graph-Backends anbinden — zuerst den
Librarian auf dem HiveMind-Server, später jede andere MCP-sprechende Memory. Die
MCP-Fassade vor dem Librarian baut ein anderer Agent parallel (T74.4); bis dahin
gibt es keinen echten Endpunkt. Zugleich sollen Quellen über die Oberfläche
angebunden werden und ihre Authentisierung pro Quelle frei wählbar sein
(Nutzerentscheid 19.11.2026: „custom, damit wir später andere Quellen anbinden
können“).

Die Nummer ADR-0095 aus dem Epic-Entwurf war beim Anlegen schon an die
Spracheingabe-Quelle vergeben; dieser Vertrag ist ADR-0096.

## Entscheidungen

1. **Generischer MCP-Client statt Librarian-Adapter.** Der Hub spricht MCP über
   Streamable HTTP (`@modelcontextprotocol/sdk`, Protokollversionen 2025-03-26 bis
   2025-11-25). Er kennt keinen Librarian-Sondercode: Eine Quelle ist ein
   Datensatz `{ label, url, auth, tools }`, kein ladbares Code-Modul. Deshalb gibt
   es (noch) keine Fabrik-Formprüfung `isValidKnowledgeFactory` — sie wird erst
   gebraucht, wenn ein Nicht-MCP-Backend als Code-Modul kommt (offene Frage im Epic).
2. **Tool-Schnittstelle v1** (verbindlich für die Fassade, EPIC-P74 §3.3):
   `kb_overview {}`, `kb_search { q, topK? }`, `kb_read { ref }`; Ergebnisse als
   `structuredContent` (Fallback: erster Text-Block als JSON). Die Tool-Namen sind
   pro Quelle überschreibbar (`tools.overview/search/read`), damit fremde
   MCP-Memories ohne Umbenennung anbindbar sind. Antworten werden mit zod geprüft;
   eine Abweichung ist ein sichtbarer Protokollfehler, kein stilles Weglassen.
3. **Authentisierung pro Quelle:** `none` (z. B. reines Tailnet), `bearer`
   (`Authorization: Bearer …`) oder `header` (eigener Header-Name, z. B.
   `X-Api-Key`). Das Geheimnis ist über die API write-only (`hasSecret`), geht nie
   in Log, URL, Status-Detail oder PWA.
4. **Speicherort des Geheimnisses:** Ein ausgehendes Token muss der Hub im
   Klartext kennen — ein Hash genügt nur für eingehende Tokens. Es liegt deshalb
   wie der Gemini-Schlüssel (T7.10) in der git-ignorierten `config`-Tabelle unter
   `data/`, getrennt von der Quell-Liste (eigener Schlüssel je Quelle), damit kein
   Listen-Export es mitnimmt. Im Repo stehen weder URL noch Token.
5. **Fail loud über einen Status je Quelle:** Jeder Aufruf (Prüfen, Suchen, Lesen)
   schreibt `status { state, at, detail, failures }` mit `state` aus
   `ok | unreachable | unauthorized | protocol | tool-error`. Die Route antwortet bei
   Fehlern 502 mit diesem Status; die Oberfläche zeigt ihn an. Kein Auto-Retry,
   kein Neustart fremder Dienste.
6. **Menschenfläche:** `/api/knowledge` ist `settings.manage` (Agenten: deny, Muster
   Vault/Verbindungen). Agenten erreichen Wissen erst über `gateway-mcp`
   (T74.7, eigene Policy-Entscheidung, K4-Budget).
7. **Inhalte sind Daten:** Treffer und Dokumente gehen nur als Text an die
   Oberfläche, nie in eine Session oder einen Prompt (PRD §8.5). Caps: `topK ≤ 20`,
   Snippet ≤ 600 Zeichen, Dokument ≤ 32 KB, jeweils mit `truncated`.

## Folgen

- K7: Die Quellen leben in der `config`-Tabelle (Backup/Recovery wie Verbindungen);
  der Status ist abgeleitet und wird durch „Prüfen“ neu gewonnen. Es entsteht kein
  Session-Zustand, also kein JSONL-Pfad.
- Contract-Erweiterungen (`graph`, `add` mit Freigaben-Queue) kommen als Nachtrag
  zu diesem ADR, nicht still.
- Tests laufen ohne Port: Der Client nimmt ein `fetch`, das in-process auf
  `WebStandardStreamableHTTPServerTransport` zeigt.

## Nachtrag T74.6/T74.7 (20.11.2026, mit den zugehörigen Commits)

Der versprochene Nachtrag für Graph, Schreiben und Agenten-Zugang:

8. **Graph und Schreiben als optionale Tools.** `kb_graph` (`{ seed, depth ≤ 3,
   maxNodes ≤ 100 }` → `{ nodes[], edges[], truncated }`, Kanten ≤ 300) und
   `kb_add` (`{ text ≤ 32 000, ref?, source? }` → `{ ref }`) sind keine Pflicht:
   Fehlt das Tool in `tools/list`, ist das ein sauberer `protocol`-Fehler; die
   Oberfläche zeigt Graph/Schreiben nur, wenn `overview().tools` es hergibt.
   Antwortformen tolerant wie v1 (Zusatzfelder fallen weg, Pflichtfelder nicht).
9. **Retrieval-Parameter sind Vertragsbestandteil:** `KnowledgeQuery` trägt
   `fusion ("sequential"|"rrf")` und `minScore (0..1)` optional — der Client
   reicht sie durch, die Oberfläche stellt sie sichtbar ein (EPIC-134: Fusion
   funktioniert nicht geglaubt; die bewährten Defaults liefert T74.8 mit Zahlen).
10. **Schreiben läuft IMMER durch die Freigaben-Queue** (EPIC-P74 §3.6), auch
    vom Menschen angefragt: `POST /api/knowledge/sources/:id/add` legt eine
    `write`-Freigabe (`action: knowledge.add`) plus persistierte Operation an
    (ADR-0019: einmalige Ausführung, `payload_hash`, Zustand `done/failed`
    sichtbar) und antwortet 202 `pending approval <id>`. Die anfragende Session
    kann sie nie selbst entscheiden (AC-P74-4). Pseudo-Session `"wissen"` in
    der Freigaben-Tabelle, Muster `„neu"` bei `session.create`.
11. **Policy-Split statt reiner Menschenfläche:** `probe/search/read/graph` und
    `GET /api/knowledge/sources` sind `knowledge.read` (Agenten allow — der
    gateway-mcp-Ruf trägt ein `agent:`-Token); `add` ist `knowledge.add`
    (Agent: approve); Quellen-Verwaltung (CRUD, Geheimnisse) bleibt
    `settings.manage`. Operations-Katalog des Gateways: `knowledge.list`,
    `knowledge.search`, `knowledge.read`, `knowledge.add` — nur über die
    bestehenden Meta-Tools, kein vierter MCP-Tab (K4 bleibt < 1 000 Tokens
    statisch; ein `hub_describe`-Lookup < 300 Tokens, testbar in
    `apps/gateway-mcp/test/k4-token-budget.test.ts`).
12. **Offline-Kopie (K10):** letzte Übersicht/Suche im localStorage
    (`ancientvoid.knowledge.v1`, Muster Automations-Cache), Zeitstempel sichtbar,
    Aktionen offline gesperrt — ein Cache beweist keinen Erfolg.

Status bleibt **Vorgeschlagen**: T74.1 (Nutzer-Review) ist das Gate; dieser
Nachtrag ist Teil desselben Reviews.
