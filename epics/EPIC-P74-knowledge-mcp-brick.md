# EPIC-P74 — Knowledge-Anbindung: MCP-Backends, modulare Quellen, teamübergreifender Brain

**Status:** Planungsentwurf (Nutzerauftrag 19.11.2026) · **Phase:** P74 · **Dauer:** ~2–3 Agenten-Tage (AV-Seite) + ~1–2 (Librarian-Seite, Hivemind-Server) · **Abhängigkeit:** keine blockierende — Quer-Epic wie P58–P73; baut auf `gateway-mcp` (Meta-Tool-Muster, Write-Gate), `LoopConnector`-Fabrikmuster (`packages/contracts`) und P49 (Vault-Tab, reiner Local-Store ohne Index) auf. ADR-0095 erforderlich (neuer Contract `KnowledgeSource`).

## 1. Ziel

AncientVoid bekommt eine standardisierte, multi-user-fähige Anbindung an Second-Brain-/
Knowledge-Graph-Backends — erster und Referenz-Backend ist der Hivemind-Librarian. Andere
User (Menschen UND Agenten-Teams) sollen dasselbe Interface nutzen können, um beliebige
Knowledge-Backends an ihren Hub zu hängen: der Librarian via MCP, aber auch jede andere
MCP-Sprechende Memory (Provider-Unabhängigkeit, kein Lock-in — gleiches Prinzip wie
Adapter/Loops). Quellen sind dabei bewusst modular: Ein Konnektor-SDK macht neue Quellen
(Filesystem/Vault, Git-Repos, Web) zu Daten + Konfiguration, nicht zu Core-Code.

Nutzerauftrag wörtlich: „ein second brain oder knowledge graph anzubinden, am besten unseren
librarian … wie können wir das so aufbauen, dass es auch andere User nutzen können. Am
besten MCP/ACP oder A2A … modular aufbauen, damit man verschiedene Möglichkeiten hat,
Quellen anzubinden." Phase 3 des vereinbarten Plans (A2A-Fassade für Agenten-Teams als
gemeinsamer Workspace) ist **Out** und wird später nachgezogen — dieses Epic legt die
Contract- und Auth-Grundlagen so, dass A2A ohne Refactor aufsetzen kann.

## 2. Scope (In / Out)

**In:**

- `KnowledgeSource`-Contract in `packages/contracts` (Fabrik-/Fähigkeiten-Muster analog
  `LoopConnector`, ADR-0095): `capabilities()`, `search`, `read`, `graph` (Nachbarn/Pfad),
  `overview`; Write-Ops nur wenn `capabilities().write`, immer durch das bestehende
  Freigaben-Gate.
- Erste Implementierung `McpKnowledgeSource`: verbindet sich als generischer MCP-Client
  (Streamable HTTP, Bearer) auf JEDEM MCP-Knowledge-Server — Referenz: der Librarian.
  Kein Librarian-Spezzialcode im AV-Core.
- Anbindung in Hub/PWA: Knowledge-Panel (Vault-Tab erweitern oder neuer Tab, nach
  ADR-0095-Entscheidung), Konfiguration pro User: MCP-URL + Token, geführt wie Loop-Onboarding.
- Librarian-MCP-Fassade (Gegenstück auf Hivemind-Server): Streamable-HTTP-MCP-Server vor
  dem bestehenden Librarian (`:18101`), Tools `kb_search/kb_read/kb_graph/kb_add/kb_overview`,
  Bearer pro User, Tenant-Namespace im Graph. Deployment via Kerrigan/Nemesis-Konvention.
- Quellen-Konnektor-SDK (Librarian-Seite): `discover → fetch → normalize`-Pipeline mit
  Checkpoint-Inkrementierung, deterministischen IDs, wegwerfbarem Index; Pilot-Konnektoren
  `filesystem-markdown` (Obsidian-Vault) und `git-repo`.
- Retrieval-Parameter (Fusion-Modus, Score-Schwellen, Top-k) als sichtbare Tool-Parameter
  mit dokumentierten Defaults — EPIC-134-Lehre: Fusion funktioniert nicht geglaubt, nur
  benchmark-bewiesen.
- `epics/README.md`-Zeile; Doku für fremde User (MCP-Client-Konfig Claude Code/Cursor/Codex).

**Out:**

- A2A-/Agent-Team-Workspace (Phase 3): Agent-Karten, Team-Shared-Graphs, Nyx/Hivemind-Cast
  als Librarian-„Agenten" — späteres Epic; hier nur Contract- und Auth-Vorbereitung.
- ACP (Agent-Client-Protokoll für UIs) — falsche Schicht für dieses Ziel.
- Direktverbindungen von AV auf Neo4j/Qdrant/PostgreSQL des Hivemind-Brain — bleibt
  verboten (Regel: DB-Zugriff nur über den Librarian).
- Volltext-/Embedding-Index im AV-Vault selbst (P49 blieb bewusst ohne; ein Index gehört
  hinter einen Knowledge-Source, nicht in den Hub).
- Auto-Sync/Watcher auf Quellen im MVP (Ingest auf Zuruf + Konnektor-Checkpoint; Scheduling
  später).

## 3. Design-Details

### 3.1 Schichten (ADR-0095)

```
AV-Hub/PWA ──KnowledgeSource-Contract (packages/contracts)
   └─ McpKnowledgeSource ──MCP (Streamable HTTP, Bearer)── Librarian-MCP-Fassade
                                  │                            └─ Librarian-API (bestehend)
                                  │                                 ├─ Qdrant (vektoriell)
                                  │                                 ├─ Neo4j (Graph)
                                  │                                 └─ PostgreSQL (Meta)
                                  └─ (später: jedes andere MCP-Knowledge-Backend)
Quellen (Vault/MD, Git, Web) ──Connector-SDK─→ Pipeline ──→ Brain (nur Librarian-Seite)
```

Vier Entscheidungen:

1. **MCP als einziges Fernprotokoll für Phase 1+2.** MCP ist Werkzeug-/Datenschicht und von
   Claude Code, Cursor, Codex, OpenCode nativ unterstützt — ein fremder User braucht nur
   URL + Token. A2A wäre Agent-Koordination (Phase 3), ACP UI-Anbindung (irrelevant).
2. **Generischer Client statt Librarian-Adapter:** AV lernt „MCP-Knowledge-Server", nicht
   „Librarian". Damit ist der Librarian austauschbar und umgekehrt AV als Frontend für
   fremde Backends nutzbar.
3. **Fassade statt Erweiterung:** Der MCP-Server ist ein eigener schlanker Dienst neben dem
   bestehenden Librarian-HTTP-API (gleiches Muster wie `gateway-mcp` als Sidecar des Hubs).
   Der Librarian-Kern bleibt unverändert; MCP-Tool-Schemas mappen 1:1 auf bestehende
   `query`/`add`-Semantik.
4. **Quellen-Plugability gehört auf die Server-Seite** (wo eh Embedding/Pipeline liegt).
   AV-Core bekommt davon nichts zu sehen — dort zählt nur das `KnowledgeSource`-Interface.

### 3.2 `KnowledgeSource`-Contract (packages/contracts)

Analog `loops/connector.ts` (`LoopConnector`/`LoopConnectorFactory`/`isValidLoopFactory`):

```ts
export interface KnowledgeCapabilities {
  search: true;
  graph: boolean;        // Nachbarn/Pfad/Backlinks verfügbar?
  write: boolean;        // add/ingest — läuft IMMER durchs Freigaben-Gate
  overview: true;        // Statistik + PROTOCOL-String (Nutzungsregeln <600 Token)
  maxOverviewBytes: number; // Caps-Garantie (K5-Geist)
}

export interface KnowledgeHit { ref: string; title: string; score: number;
  snippet: string; source?: string; tenant?: string; }

export interface KnowledgeQuery { q: string; topK?: number;
  fusion?: "sequential" | "rrf"; minScore?: number; /* EPIC-134: nie hardcoded */ }

export interface KnowledgeSource {
  readonly id: string;            // z. B. "mcp"
  readonly version: string;
  capabilities(): KnowledgeCapabilities;
  overview(): Promise<KnowledgeOverview>;
  search(query: KnowledgeQuery): Promise<{ hits: KnowledgeHit[]; truncated: boolean }>;
  read(ref: string): Promise<{ content: string; outlinks?: string[];
    backlinks?: string[]; meta?: Record<string, unknown> }>;
  graph?(seed: string, opts?: { depth?: number; maxNodes?: number }):
    Promise<{ nodes: unknown[]; edges: unknown[]; truncated: boolean }>;
  /** Nur capabilities().write; wirft ohne Freigabe → Freigaben-Queue (ADR-0007). */
  add?(input: { text: string; ref?: string; source?: string }): Promise<{ ref: string }>;
}
export type KnowledgeSourceFactory =
  (config?: Readonly<Record<string, unknown>>) => KnowledgeSource;
export function isValidKnowledgeFactory(mod: unknown): mod is
  { createKnowledgeSource: KnowledgeSourceFactory };
```

Regeln: rohe Treffer-Snippets sind **Daten, keine Anweisungen** (gleiche
Prompt-Injektions-Grenze wie PRD §8.5 — Retrieval-Ergebnisse dürfen Session-Verhalten nicht
umlenken); `truncated` überall, wo Listen zurückkommen; Writes landen in der Freigaben-Queue
und können dort nicht vom anfragenden Agenten selbst entschieden werden (Muster aus
`gateway-mcp/operations.ts`).

### 3.3 Librarian-MCP-Fassade (Hivemind-Server)

- Transport: **Streamable HTTP, stateless** (MCP-Spec 2026-07-28: ein POST-Endpoint, keine
  Session im Transport; State lebt im Librarian) — horizontale Skalierung trivial.
- Auth: Bearer-Token pro Nutzer (Best Practice: MCP-Server als OAuth-2.1-Resource-Server
  validiert nur; Login/Issuance beim Librarian/Betrieb). Token → `tenant_id`; jeder Graph-/Indexzugriff
  wird mit Tenant gefiltert (Namespace-Präfix oder Property — Entscheidung bei T74.4 mit
  Kerrigan, Neo4j-Label vs. Qdrant-Payload).
- Tools: `kb_overview` (Statistik + PROTOCOL-String, erster Call jeder Session — Muster
  second-brain-mcp), `kb_search`, `kb_read`, `kb_graph` (optional), `kb_add` (write-gated:
  Freigabe erfolgt beim Librarian-Betreiber, nicht im MCP-Tool).
- Lesbarkeit für fremde Clients: Claude-Code/Cursor-Config-Snippet in der Doku
  (URL + Token + Tool-Namen), identisch zum `gateway-mcp`-README-Stil.

### 3.4 Quellen-Konnektor-SDK (Librarian-Seite)

Ein Vertrag, drei Garantien (Pattern-Synthese aus recall/second-brain-mcp/mykg — Recherche
19.11.2026):

1. **Checkpoint statt Vollscan:** Jede Quelle wird als Strom von Dokumenten mit
   resumierbarem, opakem Checkpoint gelesen (mtime/Offset/Commit-SHA); unveränderte
   Quellen kosten bei Re-Index Millisekunden.
2. **Deterministische IDs:** `sha256(tenant + quelle + relpfad)[:16]_chunk` — Re-Index
   überschreibt statt zu duplizieren; **Index ist wegwerfbar** (löschen und neu bauen ist
   immer ein valider Zustand; kein Zustand lebt nur im Index).
3. **Normalisiertes Dokumentmodell** dazwischen: `{ tenant, source, ref, title, text,
   mtime, outlinks?, meta }` — die Pipeline (Chunking → Embedding → Graph-Extraktion)
   kennt nur dieses Modell, nie ein Quellformat.

Pilot-Konnektoren: `filesystem-markdown` (Obsidian-Vault: YAML-Frontmatter,
Wikilink-Extraktion, H2/H3-Chunking; mehrsprachiger Embedder — EPIC-134/Embedding-SOT:
beim Embedder-Wechsel Rotation, kein Re-Embed-Desaster) und `git-repo` (Doku-Dateien aus
Commits, Commit-SHA als Checkpoint). Web/URL-Konnektor bewusst später.

### 3.5 Anbindung im Hub (AV-Seite)

- Konfiguration pro Hub-User: Liste von Knowledge-Quellen `{ label, type: "mcp", url,
  token }` — Server-seitig gespeichert, Token nie in die PWA (AdapterContext-Geist).
- UI: Knowledge-Panel im bestehenden Vault-Tab-Bereich (P49-Fläche): Quell-Auswahl,
  Suche mit sichtbaren Fusion-Parametern, Treffer → Read → Graph; `add` nur als
  Freigaben-Dialog. Offline-Kopie der letzten Übersicht (Snapshot-Muster P73).
- Sessions/Agenten: `McpKnowledgeSource` ist zusätzlich als Operations-Ziel im
  `gateway-mcp` erreichbar (`hub_search` findet k-Ops) — Agenten bekommen die Knowledge-
  Tools durch das bestehende Meta-Tool-Set, kein zweiter MCP-Port pro Client nötig.

### 3.6 Sicherheit & Betrieb

- **Default OFF** für jeden neuen MCP-Pfad (Vorbild `gateway-mcp`: frischer Clone exponiert
  null MCP-Fläche); Aktivierung nur mit echtem Token (`hubctl token issue`-Äquivalent auf
  Librarian-Seite: `brain.sh token issue`).
- Write-Pfad nie ohne Freigabe; destruktive Ops (Delete/Purge) gar nicht im Tool-Set.
- Rate-Limit/Budget pro Token (kb_search topK-Deckel, Snippet-Längen-Cap) — ein fremder
  Agent darf den Brain nicht leer-saugen.
- Health: `kb_overview` ist gleichzeitig Healthcheck; AV-Watchdog-Muster (2 Fails →
  Meldung, kein Auto-Restart auf fremden Systemen).

## 4. Aufgaben (Checkliste T74.m)

- [ ] T74.1 ADR-0095: `KnowledgeSource`-Contract + Schichten- und Auth-Entscheidung
      (MCP-only Phase 1+2; A2A-vorbereitend) — Review durch Nutzer (Gate).
- [ ] T74.2 `packages/contracts/src/knowledge/source.ts` + Formprüfung
      `isValidKnowledgeFactory`; `check:contracts`/Gate erweitert.
- [ ] T74.3 `packages/`-Implementierung `McpKnowledgeSource` (Streamable-HTTP-Client,
      Bearer, Fusion-Parameter, truncated-Caps) + Unit-Tests gegen MCP-Test-Server.
- [ ] T74.4 Librarian-MCP-Fassade (Hivemind-Server): Server, Bearer/Tenant-Filter,
      Tool-Schemas; Tenant-Mapping-Entscheidung mit Kerrigan; Health = `kb_overview`.
- [ ] T74.5 Quellen-Konnektor-SDK + `filesystem-markdown`- und `git-repo`-Pilot;
      Checkpoint-/ID-Tests (Re-Index idempotent).
- [ ] T74.6 Hub-Integration: Quellen-Config (serverseitig), Knowledge-Panel (Vault-Tab),
      Freigaben-Dialog für `add`, Offline-Snapshot.
- [ ] T74.7 `gateway-mcp`-Operations-Ziel „knowledge" (Sessions/Agenten erreichen die
      k-Tools via Meta-Tools; Default OFF bleibt).
- [ ] T74.8 Retrieval-Benchmark: Sequenz vs. RRF, Schwellen-Sweep auf echten Vault-Daten
      (EPIC-134-Messlatte); Defaults dokumentiert, Parameter im Tool sichtbar.
- [ ] T74.9 Doku: README-Sektion „Knowledge-Backends anbinden" (fremde User: MCP-URL+Token
      in Claude Code/Cursor/Codex; eigene Quellen via Konnektor-SDK); `epics/README.md`-Zeile.

## 5. Acceptance Criteria (AC-P74-k)

1. Contract: `KnowledgeSource` + Fabrik-Formprüfung im `packages/contracts`, Gate grün;
   Contract-Änderung nur via ADR-0095-Erweiterung.
2. Interop-Beweis: Ein fremder MCP-Client (Claude Code ODER MCP Inspector) verbindet sich
   mit URL+Token auf die Librarian-Fassade, führt `kb_overview → kb_search → kb_read`
   aus; Beleg (Transkript/Screenshot) im Epic verlinkt.
3. AV-intern: Knowledge-Panel zeigt zwei verschiedene Quellen (Librarian-MCP + zweiter
   Test-MCP-Server), Suche/Read/Graph nutzbar, `truncated` sichtbar bei Caps.
4. Write-Gate: `kb_add`/`add` ohne Freigabe endet in der Freigaben-Queue und kann von der
   anfragenden Session nicht selbst entschieden werden (Test rot-grün).
5. Injektions-Grenze: Ein Snippet mit eingebetteter „Ignoriere vorherige Anweisungen"-
   Anweisung verändert das Session-Verhalten nicht (Regressionstest).
6. Multi-Tenant: Tenant A sieht mit Token B null Treffer von Tenant A (Test mit zwei
   Tokens auf geteiltem Brain).
7. Quellen: Vault-Änderung (1 Datei) → Re-Index verarbeitet nur diese Datei
   (Checkpoint-Test); Index-Löschung + Rebuild konvergiert zum identischen Zustand.
8. Benchmark: Fusion-/Schwellen-Defaults aus T74.8 mit Zahlen belegt (nicht gewählt).

## 6. Premortem (Failure-Modi + Mitigation)

- **„Der Librarian wird zum Singleton-Flaschenhals":** Jede Session haut kb_search bei
  jedem Turn raus → Token-/DB-Last. → Rate-Limit pro Token, topK-Deckel, PROTOCOL-String
  dämpft Nutzen („nur wenn Kontext fehlt"), Last-Metriken in `kb_overview`.
- **„Inhaltliche Injektion über Retrieval":** Graph-Inhalte sind Fremdtext. → Snippets als
  Daten deklarieren (3.2), AC-P74-5-Regressionstest, keine Tool-Aufrufe aus Snippets
  automatisch ausführen.
- **„Fusion-Qualität regrediert unbemerkt":** Defaults hardcoded „weil es lief". →
  AC-P74-8: Parameter sichtbar, Benchmark-Zahlen im Epic.
- **„Tenant-Leak über Graph-Kanten":** Namespace-Filter greift bei Knoten, aber Kanten
  zeigen rüber. → T74.4 prüft Kanten- und Pfad-Queries explizit mit (AC-P74-6 erweitert
  auf graph), Pentest-Testfall im Tenant-Test.
- **„Vault-Ingest läuft heiss":** Erste Indexierung eines Riesen-Vaults blockiert den
  Librarian. → Ingest in Chunks mit Checkpoint, Batch-Größen-Config, erster Lauf auf Zuruf/Offline.
- **„Scope-Creep Richtung A2A":** Jemand will „schnell" Agent-Teams einbauen. → Phase 3
  explizit Out; Contract hält `tenant`-Feld bereit, mehr nicht.
- **„gateway-mcp wird zum zweiten AV-MCP-Port mit eigenem Leben":** Zwei MCP-Flächen
  divergieren. → T74.7 koppelt: knowledge-Ops NUR über bestehende Meta-Tools, kein
  paralleles Tool-Set.

## 7. Definition of Done

- `npm run gate` lokal grün (inkl. neuer Contract-/Knowledge-Tests, Typecheck, Lint,
  Suite); neue Tests rot-dann-grün belegt.
- GitHub-Actions (`verify`) auf dem Abschluss-PR grün; Live-Nachweis AC-P74-2 gegen den
  echten Librarian (oder ehrliche Benennung, was auf Hivemind-Seite noch aussteht —
  Deployment liegt bei Kerrigan/Nemesis).
- AC-P74-1 bis -P74-8 mit Belegen hier vermerkt; `epics/README.md` aktualisiert;
  ADR-0095 final; Menschen-Abnahme (Knowledge-Panel im Handy-Blick) nach P000, wenn nötig.
- Keine Contract-Änderung ohne ADR; keine Direktverbindung AV → Neo4j/Qdrant/PostgreSQL
  (Librarian-Regel unangetastet, Code-Review-Punkt).
- Referenz-Messlatten eingehalten: K5 (Caps + `truncated`), K7 (Journal/Evidenz für
  Auto-Aktionen), ADR-0007 (Freigaben-Queue), PRD §8.5 (Injektions-Grenze), EPIC-134
  (Retrieval-Fusion benchmark-bewiesen), P73 (Snapshot-Muster Offline-Kopie).
