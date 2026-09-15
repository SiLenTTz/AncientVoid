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

- [x] **T1.1** Event-Normalizer — bewusst **weiterhin nicht** als separate geteilte Bibliothek gebaut, jetzt mit zwei echten Adaptern final geprüft: der tatsächlich gemeinsame Code zwischen `adapter-claude/src/normalize.ts` und `adapter-codex/src/normalize.ts` ist nur `asString()`/`summarize()` (~15 Zeilen generisches String-Handling) — die eigentlichen Mapping-Tabellen sind pro Provider komplett verschieden (Content-Block-Arrays bei claude vs. flache `item.started`/`item.completed` bei codex). Ein geteiltes Paket (+ Workspace-Dependency + eigene ADR-Pflicht als Contract) für 15 Zeilen wäre teurer als die Duplikation. Bewusst dupliziert, nicht extrahiert.
- [x] **T1.2** Adapter `claude` — `packages/adapter-claude/` (Basis-Lifecycle + Steer(prompt) via `--resume`; Steer(resume) ohne Prompt ehrlich `ok:false`, kein `recover()`). Mapping-Ground-Truth: zwei echte `claude -p --output-format stream-json`-Captures (CLI 2.1.263, `test/fixtures/`), **nicht** die vereinfachte Tabelle in §3 — die kannte `hook_started`/`hook_response`/`rate_limit_event` nicht und unterschlug, dass `assistant`/`user` Content-Block-Arrays tragen statt flacher Typen. `thinking`-Mapping unverifiziert (kein Capture mit Extended Thinking vorhanden) — Vermerk in `normalize.ts`, gehört in den Fixture-Korpus von T1.4 nachgezogen.
- [x] **T1.3** Adapter `codex` — `packages/adapter-codex/` (Basis-Lifecycle + Steer(prompt) via `exec resume`, **inkl. Version-Pinning** via `codex --version`-Handshake bei jedem `start()` — Mismatch nur Warnung, nie Abbruch — **und Degraded-Modus**: jedes unbekannte `item`/Top-Level-`type` setzt `status().state = "degraded"`). Mapping-Ground-Truth: drei echte `codex exec --json`-Captures (codex-cli 0.153.4, `test/fixtures/`) — flacher `type` pro Zeile (`thread.started`/`turn.started`/`item.started`/`item.completed`/`turn.completed`), **kein natives Kosten-Feld** irgendwo im Stream (bestätigt: `capabilities().cost = false`, echte Kosten brauchen T1.11s eigene Preistabelle). `reasoning`-Item-Typ unverifiziert (kein Capture mit sichtbarem Reasoning-Trace, `reasoning_output_tokens` war in allen drei Läufen 0).
- [x] **T1.4** Fixture-System — `scripts/capture-adapter-fixture.mjs` (aufzeichnen, Home-/Socket-Pfade anonymisieren, secret-scannen, **verweigert das Schreiben** bei Fund statt selbst zu entscheiden; smoke-getestet gegen die echte `claude`-CLI und gegen einen absichtlich sekret-haltigen Fake-Stream). Contract-Test-Eingang: `checkFixture()`/`loadFixtureLines()`/`assertFixtureEventsValid()` in `@uacc/adapter-testkit` (bisher ungetestetes Paket, jetzt mit eigener Test-Suite) — `adapter-claude` und `adapter-codex` beide darauf umgestellt, Duplikation entfernt.
- [x] **T1.5** Monitor-Dashboard (`packages/pwa/src/Dashboard.tsx`) — Sortierung nach `updatedAt` ("zuletzt aktiv", neues Feld), Kosten-Aggregation via `costUsd` (ADR-0003: neues providerneutrales Event-Feld, `SessionManager` summiert), "wartet auf dich"-Badge bei `waiting_approval`, Traffic-Light über bestehende `.pill.<status>`-Farben (keine zweite, redundante Statusanzeige). **Bewusste Abweichung von §2:** Gruppierung nach **Projekt**, nicht "Rechner" — die Kachel-Hierarchie "Rechner → Projekte → Sessions" setzt Multi-Hub-Aggregation voraus, die nirgends existiert (eine PWA spricht mit genau einem Hub über relative `/api/*`-Pfade); Projekt ist der reale, vorhandene Gruppierungsschlüssel heute. Visuell im echten Browser verifiziert (Playwright, Screenshot). Dabei zwei echte, davor unentdeckte Bugs gefunden und gefixt: BUG-0006 (PWA-Onboarding komplett unerreichbar für ein neues Gerät — Auth-Lücke + falscher Bereitschafts-Check).
- [x] **T1.6** Filter-Engine (`packages/pwa/src/SessionTail.tsx`) — die drei echten Presets aus §2/AC-P1-4 (**Lesen/Überwachen/Debuggen**), nicht die vier ad-hoc aus P0 ("Alle"/"Tool-Calls"/"Denken"). Default **Überwachen**: versteckt `thinking` UND `tool_result`-Payloads > 2 KB (gemessen via `payload.bytes`, wenn K5-geblobbt, sonst JSON-Größenschätzung). LocalStorage, gerätespezifisch, kein Server-Roundtrip. Visuell im echten Browser geprüft (Playwright): alle drei Presets zeigen die erwartete Teilmenge.
- [x] **T1.7** Thinking-Rendering — gedimmt/kursiv (bestehendes `.event.thinking`-CSS), einklappbar (Default eingeklappt, zeigt nur die 200-Zeichen-Summary; ausgeklappt zeigt `payload.text`, falls der Adapter vollen Reasoning-Text mitschickt). In Überwachen ohnehin komplett ausgeblendet (T1.6) — Toggle wirkt praktisch nur in Debuggen.
- [x] **T1.8** Tool-Call-Chips — Status `running`/`ok`/`error` (aus dem Vorhandensein und `isError` des korrelierten `tool_result`), bidirektionale Anker-Navigation (Scroll-to) zwischen `tool_use` und `tool_result` über die gemeinsame `id`/`toolUseId`, die beide echten Adapter (claude, codex) schon konsistent setzen. **Nebenfund:** der `dummy`-Referenzadapter setzte diese Korrelation gar nicht — als Vorlage für neue Adapter unvollständig und machte T1.8 mit ihm untestbar. Nachgezogen (`packages/adapter-dummy/src/index.ts`), ohne die K5-Riesenoutput-Testfixtur zu verändern (die bleibt bewusst unkorreliert, da sie keinen echten Tool-Aufruf-Zyklus simuliert).
- [x] **T1.9** Adapter-Heartbeat (`SessionManager`, `packages/core/src/sessionmanager.ts`) — alle 30 s (`DEFAULT_HEARTBEAT_MS`, konfigurierbar für Tests) ein aktiver `adapter.status()`-Poll pro laufender Session, unabhängig vom passiven `WorkerProcess.onExit`-Pfad (der erkennt nur "Prozess ist weg", nicht "Prozess lebt, antwortet aber nicht mehr"). `down`/`broken` → `status="error"` + sichtbares `adapter.down`-System-Event (Detail, kein stilles Retry). Terminal-Sessions werden nicht erneut angefasst (kein doppeltes Event). Kein neuer Health-Endpunkt nötig — `/api/sessions`/`/api/sessions/:id` tragen den Live-Status schon, das rote Badge ist das bereits bestehende `.pill.error`-CSS (kein zweiter, redundanter Indikator). **Nicht umgesetzt: echte Push-Benachrichtigungen** (AC-P1-5 verlangt "Push-Meldung am Handy") — dafür existiert nirgends im Repo eine Web-Push-Infrastruktur (VAPID-Schlüsselpaar, Subscription-Speicherung, Service-Worker-`push`-Handler); das ist ein eigenständiges Feature, kein Nebenprodukt von T1.9, und bewusst zurückgestellt statt notdürftig nachgebaut.
- [x] **T1.10** K2-Lasttest: 30 Events/s über 10 min durch Dashboard + Tail, Lag < 200 ms — echter Chromium (Playwright) rendert das T1.5-Dashboard + T1.6-Tail live gegen einen echten Hub-Server, `data-seq`-Attribut auf jeder gerenderten Event-Zeile ermöglicht Server-Emit→DOM-Render-Zeitstempel-Matching (`scripts/k2-frame-lag.mjs`). Ergebnis: 18140/18154 Events gematcht, median 3ms, p95 4ms, max 8ms — 0 über dem 200ms-Budget (Messlauf: `docs/messlauf/2026-09-15-k2-frame-lag.md`). **Zweiter AC-P1-3-Teil (Drop-on-slow unter gedrosseltem Netz) fand einen echten Bug**: `dropped:true` reagierte nie auf ein echtes gedrosseltes Netz (Playwright-CDP-Throttling, 20kbit/s), nur auf In-Process-Überlast — behoben und regressionsgetestet, siehe [BUG-0007](../bugs/bug-0007-ws-drop-on-slow-not-network-aware.md).
- [ ] **T1.11** Kosten-Schätzung für codex (Token-Counts × eigene Preis-Tabelle; „unbekannt" statt geraten — R9.7-Regel)

## 5. Acceptance Criteria

- **AC-P1-1:** Task „füge eine Funktion hinzu und teste sie" an claude über Handy gestartet →
  Tail zeigt Thinking, mindestens einen tool_use + tool_result, Abschluss-Event; Kosten im
  Dashboard sichtbar und plausibel (±10 % zur claude-eigenen `total_cost_usd`).
- **AC-P1-2:** Gleicher Flow mit codex ohne einzige Zeile UI-Anpassung (Adapter-Abstraktion
  bewiesen).
- **AC-P1-3 (K2): 🟢 erfüllt.** 30 Events/s über 10 min → kein Frame-Lag > 200 ms
  (18140/18154 gematcht, max 8ms, `docs/messlauf/2026-09-15-k2-frame-lag.md`);
  drop-on-slow greift nachweisbar bei gedrosseltem Netz (3G-Throttling im
  Browser) — erst nach Fix von BUG-0007 (`socket.bufferedAmount`-Prüfung
  fehlte), siehe T1.10.
- **AC-P1-4:** Filter „Überwachen" versteckt Thinking und tool_results > 2 KB; State überlebt
  Reload und ist gerätespezifisch (Desktop zeigt andere Filter als Handy).
- **AC-P1-5: 🟡 teilweise.** Badge-Teil erfüllt: Heartbeat poll(t alle 30 s,
  weit unter 60 s) `adapter.status()` und setzt bei `down`/`broken` sichtbar
  `status=error` (rotes `.pill.error`) + `adapter.down`-Event (T1.9,
  unit-getestet mit simuliertem Ausfall). Push-Teil offen — keine
  Web-Push-Infrastruktur im Repo, siehe T1.9-Vermerk.
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
