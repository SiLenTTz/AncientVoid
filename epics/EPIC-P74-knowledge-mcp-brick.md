# EPIC-P74 — Knowledge-Anbindung: MCP-Backends, modulare Quellen, teamübergreifender Brain

**Status:** Planungsentwurf (Nutzerauftrag 19.11.2026) · **Phase:** P74 · **Dauer:** ~2–3 Agenten-Tage (AV-Seite) + ~1–2 (Librarian-Seite, Hivemind-Server) · **Abhängigkeit:** keine blockierende — Quer-Epic wie P58–P73; baut auf `gateway-mcp` (Meta-Tool-Muster, Write-Gate), `LoopConnector`-Fabrikmuster (`packages/contracts`) und P49 (Vault-Tab, reiner Local-Store ohne Index) auf. ADR-0096 erforderlich (neuer Contract `KnowledgeSource`).

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
  `LoopConnector`, ADR-0096): `capabilities()`, `search`, `read`, `graph` (Nachbarn/Pfad),
  `overview`; Write-Ops nur wenn `capabilities().write`, immer durch das bestehende
  Freigaben-Gate.
- Erste Implementierung `McpKnowledgeSource`: verbindet sich als generischer MCP-Client
  (Streamable HTTP, Bearer) auf JEDEM MCP-Knowledge-Server — Referenz: der Librarian.
  Kein Librarian-Spezzialcode im AV-Core.
- Anbindung in Hub/PWA: Knowledge-Panel (Vault-Tab erweitern oder neuer Tab, nach
  ADR-0096-Entscheidung), Konfiguration pro User: MCP-URL + Token, geführt wie Loop-Onboarding.
- Librarian-MCP-Fassade (Gegenstück auf Hivemind-Server): Streamable-HTTP-MCP-Server vor
  dem bestehenden Librarian, Tools `kb_search/kb_read/kb_graph/kb_add/kb_overview`,
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

### 3.1 Schichten (ADR-0096)

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

- Transport: **Streamable HTTP, stateless** (ein POST-Endpoint, keine Session im
  Transport; State lebt im Librarian) — horizontale Skalierung trivial. Die Fassade muss
  mindestens eine der Protokollversionen **2025-03-26 bis 2025-11-25** aushandeln: Das im Hub
  eingesetzte `@modelcontextprotocol/sdk` 1.32.2 kennt nichts Neueres (Review 19.11.: das
  zuvor genannte Spec-Datum „2026-07-28“ war im Repo nicht belegbar).
- Auth: Der Hub ist pro Quelle konfigurierbar (`none` | `bearer` | `header` mit eigenem
  Header-Namen — Nutzerentscheid 19.11.2026, ADR-0096 §3). Für die Librarian-Fassade
  empfohlen: `Authorization: Bearer <token>` pro Nutzer (MCP-Server als
  OAuth-2.1-Resource-Server validiert nur; Login/Issuance beim Librarian/Betrieb).
  Fehlendes/falsches Token → HTTP 401. Token → `tenant_id`; jeder Graph-/Indexzugriff
  wird mit Tenant gefiltert (Namespace-Präfix oder Property — Entscheidung bei T74.4 mit
  Kerrigan, Neo4j-Label vs. Qdrant-Payload).
- Lesbarkeit für fremde Clients: Claude-Code/Cursor-Config-Snippet in der Doku
  (URL + Token + Tool-Namen), identisch zum `gateway-mcp`-README-Stil.

#### 3.3.1 Tool-Schnittstelle v1 (verbindlich für T74.4 — Übergabe an den Fassaden-Agenten)

Festgelegt 19.11.2026 (Nutzerauftrag: „im Epic anpassen, damit ich es dem anderen Agent
geben kann“); der Hub-Client (T74.6a) ist dagegen gebaut und getestet. Änderungen nur
gemeinsam mit einem Nachtrag zu ADR-0096.

| Tool | Argumente (JSON-Schema-Kern) | `structuredContent` der Antwort |
|---|---|---|
| `kb_overview` | `{}` | `{ summary: string, protocol?: string, stats?: object }` — `summary` kurz (≤ 2 KB), `protocol` = Nutzungsregeln < 600 Token |
| `kb_search` | `{ q: string (1–500), topK?: integer (1–50), fusion?: "sequential"\|"rrf", minScore?: number }` | `{ hits: [{ ref: string, title: string, score?: number, snippet: string, source?: string }], truncated: boolean }` |
| `kb_read` | `{ ref: string }` (ein `ref` aus `kb_search`) | `{ ref: string, title?: string, content: string, outlinks?: string[], backlinks?: string[], truncated?: boolean }` |
| `kb_graph` | später (T74.4/T74.6, Nachtrag ADR-0096) | — |
| `kb_add` | später; write-gated, Freigabe beim Librarian-Betreiber | — |

Regeln für die Fassade:

1. Ergebnis immer als `structuredContent` (MCP 2025-06-18+) **und** gespiegelt als ein
   `text`-Block mit demselben JSON (ältere Clients). Der Hub liest `structuredContent`,
   sonst den ersten Text-Block als JSON.
2. Fachfehler (unbekannte `ref`, Backend down) → `isError: true` plus Text-Block mit
   einer kurzen, secret-freien Meldung. Kein HTTP-500 für Fachfehler.
3. Unbekannte Zusatzfelder sind erlaubt (der Hub ignoriert sie); Pflichtfelder fehlen nie —
   sonst meldet der Hub einen Protokollfehler.
4. `kb_overview` ist zugleich Healthcheck: es muss ohne Argumente schnell antworten.
5. Die Tool-Namen sind im Hub pro Quelle überschreibbar; die Fassade hält trotzdem die
   `kb_*`-Namen ein (Interop mit Claude Code/Cursor, AC-P74-2).

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

- Konfiguration pro Hub: Liste von Knowledge-Quellen `{ label, url, auth: { kind:
  "none" | "bearer" | "header", header? }, secret (write-only), tools? }` — über die
  Oberfläche anlegbar (Nutzerentscheid 19.11.2026), serverseitig in der git-ignorierten
  `config`-Tabelle gespeichert (Geheimnis getrennt von der Liste, ADR-0096 §4), Geheimnis
  nie in die PWA (AdapterContext-Geist). Status je Quelle (`ok | unreachable |
  unauthorized | protocol | tool-error`) ist sichtbar — Fail loud.
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

- [ ] T74.1 ADR-0096: `KnowledgeSource`-Contract + Schichten- und Auth-Entscheidung
      (MCP-only Phase 1+2; A2A-vorbereitend) — Review durch Nutzer (Gate).
- [ ] T74.2 `packages/contracts/src/knowledge/` (Contract + Schemas, Kern liegt mit T74.6a
      vor) + Formprüfung `isValidKnowledgeFactory` (**offen**, siehe §8 F5); Contract-Test in
      `packages/contracts/test/`, Grenze über `check:arch` (ein `check:contracts` gibt es nicht).
- [ ] T74.3 `packages/`-Implementierung `McpKnowledgeSource` (Streamable-HTTP-Client,
      Bearer, Fusion-Parameter, truncated-Caps) + Unit-Tests gegen MCP-Test-Server.
- [ ] T74.4 Librarian-MCP-Fassade (Hivemind-Server): Server, Bearer/Tenant-Filter,
      Tool-Schemas; Tenant-Mapping-Entscheidung mit Kerrigan; Health = `kb_overview`.
- [ ] T74.5 Quellen-Konnektor-SDK + `filesystem-markdown`- und `git-repo`-Pilot;
      Checkpoint-/ID-Tests (Re-Index idempotent).
- [ ] T74.6a Erster Anwendungsfall „HiveMind-Librarian anbinden" (Nutzerauftrag 19.11.2026):
      Quelle über die Einstellungen anlegen (URL, Auth `none|bearer|header`, Geheimnis
      write-only), prüfen (`tools/list` + `kb_overview`), suchen und lesen; Status je Quelle
      sichtbar (Fail loud). Generischer Client gegen §3.3.1, getestet gegen einen
      In-Process-MCP-Server; Live-Nachweis gegen den echten Librarian folgt mit T74.4.
      Messlatten: K5-Geist (Caps + `truncated`), K7 (config-Tabelle, Status abgeleitet).
- [ ] T74.6 Hub-Integration (Rest nach T74.6a): Knowledge-Panel im Vault-Tab,
      Freigaben-Dialog für `add`, Offline-Snapshot (K10).
- [ ] T74.7 `gateway-mcp`-Operations-Ziel „knowledge" (Sessions/Agenten erreichen die
      k-Tools via Meta-Tools; Default OFF bleibt; K4: Schema-Kosten bleiben < 1.000 Tokens
      statisch, < 300 pro Lookup).
- [ ] T74.8 Retrieval-Benchmark: Sequenz vs. RRF, Schwellen-Sweep auf echten Vault-Daten
      (EPIC-134-Messlatte); Defaults dokumentiert, Parameter im Tool sichtbar.
- [ ] T74.9 Doku: README-Sektion „Knowledge-Backends anbinden" (fremde User: MCP-URL+Token
      in Claude Code/Cursor/Codex; eigene Quellen via Konnektor-SDK); `epics/README.md`-Zeile.

## 5. Acceptance Criteria (AC-P74-k)

1. Contract: `KnowledgeSource` + Fabrik-Formprüfung im `packages/contracts`, Gate grün;
   Contract-Änderung nur via ADR-0096-Erweiterung.
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
  ADR-0096 final; Menschen-Abnahme (Knowledge-Panel im Handy-Blick) nach P000, wenn nötig.
- Keine Contract-Änderung ohne ADR; keine Direktverbindung AV → Neo4j/Qdrant/PostgreSQL
  (Librarian-Regel unangetastet, Code-Review-Punkt).
- Referenz-Messlatten eingehalten: K5 (Caps + `truncated`), K7 (Journal/Evidenz für
  Auto-Aktionen), ADR-0007 (Freigaben-Queue), PRD §8.5 (Injektions-Grenze), EPIC-134
  (Retrieval-Fusion benchmark-bewiesen), P73 (Snapshot-Muster Offline-Kopie).

## 8. Review 19.11.2026 (vor T74.6a)

Geprüft gegen PRD §9 (K1–K10), `AGENTS.md`-Architekturregeln und ADR-0020. Eindeutige
Befunde sind oben eingearbeitet (✅), offene Designfragen bleiben markiert (❓).

- ✅ F1 **ADR-Nummer kollidierte:** ADR-0095 ist die Spracheingabe-Quelle (#199) → ADR-0096.
- ✅ F2 **Spec-Datum nicht belegbar:** „MCP-Spec 2026-07-28“ → Protokollversionen
  2025-03-26…2025-11-25, die das SDK 1.32.2 im Repo tatsächlich spricht (§3.3).
- ✅ F3 **`check:contracts` existiert nicht** (T74.2) → Contract-Test + `check:arch`.
- ✅ F4 **Fassaden-Schnittstelle fehlte als Vertrag:** Tool-Namen standen nur als Liste,
  ohne Argumente/Antwortform → §3.3.1 verbindlich; Auth pro Quelle (Nutzerentscheid).
- ✅ F6 **Server-Detail im Repo:** konkrete Librarian-Port-Angabe entfernt (keine
  HiveMind-Adressen in Commits).
- ✅ F7 **Messlatten-Bezüge lückenhaft:** K10 (Offline-Snapshot) an T74.6, K4
  (Schema-Kosten) an T74.7 ergänzt; K5 gilt für Events — für HTTP-Antworten hier als
  Caps + `truncated` (K5-Geist), K7 als config-Tabelle + abgeleiteter Status.
- ❓ F5 **Fabrik-Formprüfung `isValidKnowledgeFactory` ist mit „generischer MCP-Client“
  (§3.1 Entscheidung 2) überflüssig:** Quellen sind Konfiguration, kein ladbarer Code.
  Vorschlag: streichen, bis ein Nicht-MCP-Backend als Code-Modul kommt. Nicht still
  entschieden — T74.6a baut ohne sie.
- ❓ F8 **Scope-Schnitt AV ↔ HiveMind:** T74.4, T74.5, T74.8 und AC-P74-6/-7/-8 sind
  Arbeit und Belege im HiveMind-Repo; `npm run gate` (DoD) kann sie nicht prüfen.
  Vorschlag: eigenes HiveMind-Epic, hier bleiben §3.3.1 als Schnittstelle und AC-P74-2 als
  Interop-Beleg. Bis zur Entscheidung zählt das Epic sie mit.
- ❓ F9 **„multi-user-fähig“:** Der Hub kennt Geräte-Tokens, keine Nutzerkonten. „Pro
  Hub-User“ (§3.5) wurde zu „pro Hub“ präzisiert; Mehrnutzerfähigkeit heißt hier: jeder
  Nutzer betreibt eigenen Hub mit eigenem Token gegen die geteilte Fassade (Tenant per
  Token). Bestätigung offen.
- ❓ F10 **Snapshot-Muster P73 für die Offline-Kopie** (T74.6) — P73 ist selbst noch offen;
  Abhängigkeit benennen oder Muster aus P49/K10 nehmen.
- Ansatz insgesamt **schlüssig:** MCP als einziges Fernprotokoll, generischer Client,
  Fassade statt Librarian-Umbau, Quellen-Plugability auf Server-Seite. Die Schnitte passen
  zu ADR-0020 (Contract `packages/contracts/src/knowledge/`, Core-Modul `knowledge`,
  Route `apps/hub/src/modules/knowledge/`, PWA-Feature `knowledge`).

**Gating:** Formal nicht erfüllt — P73 ist offen (begonnen 19.11.2026). Das Epic beruft
sich wie P58–P73 auf die Quer-Epic-Praxis („keine blockierende“); gemeinsame Codeflächen
mit P73 gibt es nicht. T74.6a läuft auf ausdrücklichen Nutzerauftrag vom 19.11.2026; ob
die Quer-Epic-Ausnahme für P74 gilt, bleibt Nutzerentscheid (❓ G1). Internes Gate: ADR-0096
steht auf „Vorgeschlagen“, T74.1 (Nutzer-Review) ist offen. P30/P31 unberührt (On hold).

## 9. Schnitt T74.6a (Skill `concept-phase`, 19.11.2026)

Evidence: §3.3.1, §3.5; Muster `packages/core/src/modules/connections/` (config-Tabelle,
write-only Geheimnis), `apps/hub/src/platform/policy.ts` (Menschenfläche),
`apps/gateway-mcp` (SDK 1.32.2 im Workspace).

| Slice | Vertikal | Testanker |
|---|---|---|
| S1 Quelle anlegen, Geheimnis bleibt write-only | contracts-Schema → core-Store → Route → PWA-Formular | `packages/contracts/test/knowledge.test.ts`, `apps/hub/test/modules/knowledge/knowledge.test.ts` |
| S2 Prüfen + Status (Fail loud) | core-MCP-Client → Status → Route 502 → PWA-Statuszeile | `packages/core/test/modules/knowledge/mcp-source.test.ts` (In-Process-MCP-Server: ok, 401, unerreichbar, fehlendes Tool, Protokollbruch) |
| S3 Suchen + Lesen mit Caps | core → Route → PWA-Trefferliste/Leseansicht (Text, nie Instruktion) | dieselben Dateien + `e2e/specs/knowledge-sources.spec.ts` |

Dimensionen: *Fidelity* — echter MCP-Protokollpfad (SDK-Server in-process), kein echter
Librarian (folgt T74.4). *Scope* — nur lesen; `graph`/`add`/gateway-Ziel/Vault-Panel
draußen. *Reuse* — SDK aus `gateway-mcp`, Store-Muster aus `connections`. *Edges* —
Server weg, Timeout, 401, Tool fehlt, Antwort ohne Pflichtfeld, `isError`, Riesen-Snippet,
leere Trefferliste, Geheimnis-Wechsel/-Entfernen, Quelle gelöscht während Anfrage.
*Dependencies* — Fassade (T74.4, paralleler Agent). *Non-functional* — Timeout 10 s,
keine Retries, Caps aus ADR-0096 §7.

Fragility: Ändert die Fassade Feldnamen, meldet der Hub `protocol` statt still leerer
Treffer; Tool-Umbenennung ist pro Quelle konfigurierbar. Ein künftiger Agentenzugang
(T74.7) darf Inhalte nur als Daten zurückgeben (PRD §8.5). Out of scope: weitere Backends,
A2A, P30/P31.
