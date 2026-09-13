# EPIC-P1 — Adapter claude + codex, Monitor-Dashboard, Chat-Tail mit Filtern

**Status:** offen · **Phase:** P1 · **Dauer:** 1–1,5 Agenten-Wochen · **Abhängigkeit:** P0 grün
**Ziel-Machines:** Omarchy (Prio 1), silenttz-server (Prio 2, gleiches Image)

---

## 1. Ziel

Der Hub steuert die zwei wichtigsten Provider real an und zeigt deren Aktivität mobil an:
Claude Code über `claude -p --output-format stream-json` (Referenz-Adapter) und Codex
über `codex exec` JSON-Events. Dazu kommen das Monitor-Dashboard (Rechner → Projekt →
Session) und der Session-Tail mit drei Filter-Presets.

## 2. Scope

### In
- Adapter `claude`: stream-json-Parsing, Thinking/Tool-Calls als separate NormalizedEvents,
  `total_cost_usd`-Extraktion, Session-Resume via `session_id`
- Adapter `codex`: exec-JSON-Events, Pinning der CLI-Version, Format-Change-Detection
- Contract-Tests mit Record/Replay (gespeicherte CLI-Rohstreams als Fixtures)
- Monitor-Dashboard (S1): Rechner-Kacheln → Projekte → Sessions, Traffic-Light,
  Kosten-Zähler, „wartet auf mich"-Badge (Basis für Approval-Queue in P2)
- Chat-Tail (S2) mit Filter-Presets: Überwachen / Debuggen / Lesen; Filter-State pro
  Gerät in LocalStorage (kein Server-Roundtrip)
- Anker-Navigation: Tool-Call-Chip ↔ Tool-Result bidirektional verlinkt
- Heartbeat pro Adapter (30 s) + Push/Red-Badge bei Ausfall (Sensorik-Basis)

### Out
- Diff-Ansicht, Approvals, Budget-Enforcement — P2
- copilot/swarm/zai/local-llm/cursor — P3
- Sprach-Features — P3

## 3. Provider-Spezifika

### Claude Code (Referenz-Adapter, „goldener Pfad")
| Aspekt | Umsetzung |
|---|---|
| Spawn | `claude -p "<prompt>" --output-format stream-json --json-schema <optional>` im tmux-Worker |
| Event-Mapping | `init`→system, `assistant`→assistant, `thinking`-Block→thinking (gedimmt), `tool_use`→tool_use, `tool_result`→tool_result (K5-Cap!), `api_retry`→system-warning |
| Kosten | `total_cost_usd` aus Result-Event direkt übernehmen (keine Preis-Tabelle nötig) |
| Steer | Folge-Prompts via Session-Resume mit `session_id` |
| Risiko | Stream-Umfang bei langen Sessions → K5-Kapplung + Blob-Verlagerung ist Pflicht, nicht Option |

### Codex CLI
| Aspekt | Umsetzung |
|---|---|
| Spawn | `codex exec "<prompt>"` mit JSON-Event-Stream |
| Version-Pinning | `codex --version` im Adapter-Handshake; bei Mismatch Warnung, nicht Abbruch |
| Format-Change-Detection | Unbekannte Event-Typen → `system-warning` + `adapter.degraded`-Badge, niemals still droppen |
| Contract-Test | Fixture-Rohstreams einfrieren; neues CLI-Release → Fixture-Diff-Test |

## 4. Aufgaben

- [ ] **T1.1** Event-Normalizer-Bibliothek: provider-Events → NormalizedEvent (gemeinsamer Code, adapter-spezifische Mapper)
- [ ] **T1.2** Adapter `claude` vollständig (inkl. Steer/Resume)
- [ ] **T1.3** Adapter `codex` vollständig (inkl. Version-Pinning, Degraded-Modus)
- [ ] **T1.4** Fixture-System: echte Streams aufzeichnen, anonymisieren (keine Secrets!), als Contract-Test-Eingang
- [ ] **T1.5** Monitor-Dashboard-Komponente (S1) mit Sortierung „zuletzt aktiv", Kosten-Aggregation je Session/Tag
- [ ] **T1.6** Filter-Engine (Client-seitig) + drei Presets + LocalStorage-Persistenz
- [ ] **T1.7** Thinking-Rendering: gedimmt/kursiv, einklappbar, Default im Preset „Überwachen" aus
- [ ] **T1.8** Tool-Call-Chips mit Status (running/ok/error) + Anker-Navigation zu Result
- [ ] **T1.9** Adapter-Heartbeat + Health-Endpoint + Red-Badge/Push bei Ausfall
- [ ] **T1.10** K2-Lasttest: 30 Events/s über 10 min durch Dashboard + Tail, Lag < 200 ms
- [ ] **T1.11** Kosten-Schätzung für codex (Token-Counts × eigene Preis-Tabelle; „unbekannt" statt geraten — R9.7-Regel)

## 5. Acceptance Criteria

- **AC-P1-1:** Task „füge eine Funktion hinzu und teste sie" an claude über Handy gestartet →
  Tail zeigt Thinking, mindestens einen tool_use + tool_result, Abschluss-Event; Kosten im
  Dashboard sichtbar und plausibel (±10 % zur claude-eigenen `total_cost_usd`).
- **AC-P1-2:** Gleicher Flow mit codex ohne einzige Zeile UI-Anpassung (Adapter-Abstraktion
  bewiesen).
- **AC-P1-3 (K2):** 30 Events/s über 10 min → kein Frame-Lag > 200 ms, drop-on-slow greift
  nachweisbar bei gedrosseltem Netz (3G-Throttling im Browser).
- **AC-P1-4:** Filter „Überwachen" versteckt Thinking und tool_results > 2 KB; State überlebt
  Reload und ist gerätespezifisch (Desktop zeigt andere Filter als Handy).
- **AC-P1-5:** claude-CLI-Prozess hart töten → Dashboard zeigt innerhalb 60 s
  `adapter.down` rotes Badge + Push-Meldung am Handy.
- **AC-P1-6:** Anonymisierte Fixtures enthalten keine Secrets (grep-basierter
  Secret-Scanner im CI als Gate).

## 6. Premortem

**Ende P1, gescheitert. Warum?**
1. *Codex-Stream ist instabiler als angenommen* (Issue #4219 in Bewegung) → halber Sprint
   geht in Parser-Rettung. Mitigation: Degraded-Modus von Tag 1, Fixture-Diffs telegrafieren
   Bruch sofort.
2. *Thinking-Streams sind riesig* → K5-Kappung verwässert R4 („voller Reasoning-Trace").
   Mitigation: Thinking landet vollständig im Blob, UI lädt on demand nach — „vollständig"
   heißt abrufbar, nicht sofort gerendert.
3. *Steer/Resume bei claude bricht bei Tool-Use-Sessions* → Mitigation: Resume-Matrix im
   Contract-Test (idle-resume, mid-tool-resume, post-approval-resume).
4. *Dashboard wird zum Generalfix für alle UI-Wünsche* → Scope-Creep. Mitigation: Jede
   Zusatz-UI braucht Ticket + Messlatten-Bezug.

## 7. Definition of Done

Alle ACs grün + beide Adapter als „proven" in der README-Matrix markiert + Kosten-Anzeige
mit Quellenangabe (claude: nativ / codex: eigene Tabelle, Datum) + Fixture-Repo-Hygiene
(Max-Größe, Anonymisierung dokumentiert).
