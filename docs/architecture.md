# Architektur (P0)

Basis: PRD §4 und `epics/EPIC-P0-hub-kern.md`. Diese Doku beschreibt den
umgesetzten Stand; Abweichungen = ADR-Pflicht.

## Topologie

```
Handy (PWA) ── Tailscale serve (HTTPS, keine öffentlichen Ports) ──> Hub-Daemon (Node, loopback)
                                                                      │
                                                          ┌───────────┴───────────┐
                                                     AdapterRegistry        WorkerRunner
                                                     (dummy, eigene …)      (tmux default, process fallback)
                                                                              │
                                                                    data/sessions/<id>/
                                                                    events.jsonl · snapshot.json · blobs/
```

## Pakete & Abhängigkeitsrichtung

```
@uacc/contracts   ← @uacc/core ← @uacc/server → PWA (nur HTTP/WS)
       ↑              ↑
       ├── @uacc/workers (WorkerRunner-Implementierungen)
       ├── @uacc/adapter-dummy (Referenz-Adapter)
       └── @uacc/adapter-testkit (Contract-Suite für Fremd-Adapter)
```

Regeln:

- Abhängigkeiten zeigen **nur zu contracts**, nie quer zwischen
  Implementierungspaketen.
- Adapter (auch Fremd-Adapter) importieren ausschließlich `@uacc/contracts`.
- Der Hub kennt Adapter nur über die Registry (Built-ins + dynamisches Laden).

## Kernkomponenten

### EventStore (`@uacc/core`)

- Kanonisch: `data/sessions/<id>/events.jsonl`, append-only, eine Zeile pro
  `NormalizedEvent`.
- **K5-Enforcement:** serialisierter Payload > 4 KB → kompletter Payload in
  `blobs/<sha256>`, im Stream bleibt Anker (`{truncated, bytes, preview}`) +
  `blob_ref`. Adapter können vorher selbst via `ctx.blob()` auslagern.
- **Durability:** gebatchtes fsync (alle 100 ms oder 50 Events) — gerade
  genug für kill -9 ohne I/O-Thrashing bei 30 ev/s (Premortem P0-3).
- `replay()` überspringt defekte/torn Zeilen (Crash-Resilienz).

### SessionManager (`@uacc/core`)

- Lifecycle-Statusmaschine: `idle → starting → working → waiting_approval →
  parked → stopping → stopped / error` (illegale Transitionen werfen).
- Jede Zustandsänderung ist `system`-Event + Snapshot (`snapshot.json`).
- `recoverAll()` (K7): SQLite-Rows + JSONL-Replay + optional
  `adapter.recover()` + tmux-Orphan-Reaping. Restore-Ziel < 3 s.
- Adapter bekommen nur `AdapterContext` — emit/blob/spawnWorker/log/signal.

### AdapterRegistry (`@uacc/core`)

- Built-ins (`dummy`) + `hub.config.json`-Einträge, dynamisch geladen via
  `import()` (relativer Pfad → File-URL; sonst npm-Package-Name).
- Shape-Check beim Laden (`createAdapter(config)` vorhanden?) — kaputte
  Adapter failen laut beim Hub-Start.

### WorkerRunner (`@uacc/workers`)

- `TmuxRunner` (Default): Session `uacc-<sessionId>`, `remain-on-exit` +
  `respawn-pane` (race-frei), Output via `pipe-pane` in Log-Datei (getailt),
  Exit-Marker `__UACC_EXIT__<code>`, attach-fähig für Notfall-Debug.
- `ProcessRunner` (Fallback ohne tmux): plain child_process, kein
  Restart-Überleben — explizit dokumentierter Trade-off.

### Server (`@uacc/server`)

- Fastify, REST (`/api/health`, `/api/adapters`, `/api/sessions*`,
  `/api/tokens*`) + WS `/api/events/:id/tail`.
- **T1.5-3/ADR-0004:** `GET /api/adapters/:id/usage` — Account-Level-
  Kontingent-Schnappschuss (ein Wert pro Adapter, nicht pro Session), aus
  `SessionManager.usageByAdapter` (In-Memory, nicht K7-persistiert, nicht
  über Sessions summiert). `supported:false` statt geratenem Wert für
  Adapter ohne Quota-Signal (heute: `codex`).
- **T1.5-4:** `GET /api/projects` — Host-Projekt-Erkennung aus
  `projectRoots` (`docs/configuration.md`), Tiefe 1, `.git`-Filter.
- **T1.5-5:** `POST /api/sessions` lehnt einen `project`-Pfad außerhalb der
  konfigurierten `projectRoots` mit 4xx ab (`isProjectPathAllowed()`).
- **T1.5-8:** `POST /api/prompt-enhance` — Prompt-Umformulierung über den
  bereits gewählten Coding-Adapter selbst (kein separates Modell, siehe
  EPIC-P1.5 §3.4), läuft mit `cwd` im Zielprojekt, hinter demselben
  Containment-Schutz wie Session-Erstellung.
- **T1.5-10/ADR-0005:** `GET /api/skills?project=<pfad>` — Skills/Agents aus
  `<projekt>/.claude/skills/` + `.claude/agents/` (`@uacc/core`s
  `scanProjectSkills()`), gleicher Containment-Schutz.
- Auth-Hook: Device-Token (Bearer/Query), optional Tailnet-Identitätszwang
  (`Tailscale-User-Login`-Header). `/api/health` bleibt offen.
- **WS-Delta-Protokoll (ADR-P0-4):** `hello{lastSeq}` → nummerierte
  `events`-Batches mit `highWater`; Client erkennt Lücken → `resync{since}`;
  **drop-on-slow**: Socket-Puffer max 100 Events, ältere werden gedroppt und
  `dropped:true` gesetzt → Client resynct. Kein Backpressure-Lag (K2).
- Statisches Serving der gebauten PWA (`pwaDir`), SPA-Fallback.

### PWA (`@uacc/pwa`)

- Preact + Vite, dark-first, Thumb-Zone-Aktionen unten.
- Session-Liste (Auto-Refresh), Session-Tail mit gerätelokalen Filtern
  (localStorage), WS-Gap-Resync, Reconnect mit Backoff.
- Service Worker: Network-First für `/api/sessions`, Fallback auf Cache mit
  `X-UACC-Cached-At` → Badge „Daten vom <Zeitstempel>" (K10).

## Persistenz-Schema (SQLite, `node:sqlite`)

- `sessions` (id, adapter, project, worktree_sha, model, status, created_at,
  budget_usd, adapter_version, last_seq)
- `device_tokens` (token_hash, label, created_at, last_used_at) — Plaintext
  wird genau einmal bei `token issue` gezeigt.
- `config` (key, value) · `_migrations` (Runner: `BEGIN/COMMIT` pro Migration).

## Entscheidungs-Log (ADR-Kurzform)

| ADR | Entscheidung | Warum |
|---|---|---|
| P0-1 | Node statt Python; Fastify + ws | agent-bus-DNA, nativer WS/PWA-Stack |
| P0-2 | JSONL (Wahrheit) + SQLite (Indizes) | grep-/diff-able, Brain-kompatibel |
| P0-3 | tmux hinter `WorkerRunner` | attachbar, Restart-Überleben, evox2-Fallback möglich |
| P0-4 | PWA ist Projektions-Renderer | Deltas + Seq + Resync statt Client-State-Monolith |
| P0-5 | Node-Strip-Types ohne Build | keine Parameter-Properties/Enums; `node src/main.ts` läuft direkt |
| P0-6 | `node:sqlite` statt better-sqlite3 | keine native Dependency, Node ≥ 22.5 |
| [0004](adr/0004-account-level-usage-quota.md) | Kontingent ist Account-, nicht Session-Zustand | ein `claude`-Limit gilt fürs ganze Konto, nicht pro Session — Summieren wäre falsch |
| [0005](adr/0005-skill-agent-invocation-mechanism.md) | Skill/Agent-Übergabe pro Adapter verifiziert statt angenommen | `claude` hat zwei echte Mechanismen (`/skill`-Präfix, `--agent`-Flag), `codex` keinen — beide laufen über `SessionSpec.args`, kein Contract-Bruch |

Neue Architekturentscheidungen: `docs/adr/` + PR.
