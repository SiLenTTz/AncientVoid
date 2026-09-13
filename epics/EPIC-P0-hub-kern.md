# EPIC-P0 — Hub-Kern: Sessions, EventStore, tmux-Worker, Tailscale-serve, PWA-Gerüst

**Status:** offen · **Phase:** P0 · **Dauer:** 1 Agenten-Woche · **Priorität:** P0 (Blocker für alles)
**Ziel-Machine:** Omarchy (Entwicklung), silenttz-server (Staging) · **Evox2:** explizit out of scope

---

## 1. Ziel

Ein minimaler, aber **korrekter** Hub-Daemon läuft auf Omarchy: Er kann Sessions als
First-Class-Objekte anlegen, deren Events in einem append-only JSONL-Stream persistieren,
pro Session einen tmux-Worker verwalten, sich über Tailscale serve exponieren und ein
PWA-Gerüst ausliefern, das den State einer Dummy-Session live anzeigt.

P0 liefert **keinen echten Agenten** — nur die Maschinerie plus Dummy-Adapter, der
synthetische Events in allen Typen erzeugt. Wer in P0 Integration mit Codex/Claude
einbaut, verletzt den Scope.

## 2. Scope

### In
- Node.js/TypeScript-Daemon (ESM, strict mode), Prozess-Modell: 1 Daemon, n Worker
- SQLite-Persistenz (Sessions, Config, BudgetState-Skelett)
- JSONL-EventStore mit Blob-Verlagerung (Events > 4 KB Payload → `blobs/<session>/`)
- tmux-Worker-Lifecycle (spawn, attach-fähig für Debug, sauberes Reaping)
- Tailscale serve Integration + Device-Token-Auth
- PWA-Gerüst (Preact oder Web Components, dark-first, Service Worker, Manifest)
- WebSocket-Push von Events an die PWA (drop-on-slow, kein Backpressure-Lag)
- Dummy-Adapter mit steuerbarem Event-Generator (für Lasttests K8)
- CLI-Tool `hubctl` (sessions list/show/tail — Referenz-Client)

### Out
- Echte Coding-Adapter (claude/codex) — P1
- Diff-Ansicht, Approvals, Budgets-Enforcement — P2
- Sprachsuche, weitere Adapter — P3
- MCP-Gateway, Brain-Skill, Windows — P4

## 3. Architektur-Entscheidungen (ADRs, Epic-lokal)

- **ADR-P0-1: Node statt Python.** Begründung: agent-bus-DNA, nativer WS-Stack,
  PWA-Tooling. Kein Framework-Monolithen; Fastify oder plain http+ws.
- **ADR-P0-2: JSONL + SQLite, keine Eventstore-DB.** Begründung: grep-able, diff-able,
  Brain-kompatibel, kein weiterer Dienst. SQLite dient Indizes/State, JSONL ist Wahrheit.
- **ADR-P0-3: tmux, nicht child_process direkt.** Begründung: attachbar für Notfall-Debug
  (`tmux attach -t uacc-<session>`), überlebt Daemon-Restart, bewährtes Worker-Pattern
  (ccswarm/herdr-Muster).
- **ADR-P0-4: PWA ist Projektions-Renderer.** Kein State-Monolith im Client; Server sendet
  Deltas mit Sequenznummern, Client resynct bei Gap.

## 4. Datenmodell

### Session-Record (SQLite)
```json
{
  "id": "uuid", "adapter": "dummy", "project": "/path/to/repo",
  "worktree_sha": "abc123", "model": "n/a", "status": "idle|working|waiting_approval|error",
  "created_at": "...", "budget_usd": null, "adapter_version": "0.1.0"
}
```

### NormalizedEvent (JSONL, eine Zeile pro Event)
```json
{
  "seq": 42, "ts": "...", "type": "user|assistant|thinking|tool_use|tool_result|gate|error|system",
  "summary": "<= 200 chars", "payload": {...}, "blob_ref": "sha256|null", "tokens_est": 123
}
```
Regel: `payload` darf niemals > 4 KB sein — Überschuss geht in Blob + `blob_ref` (K5).

## 5. Aufgaben

- [ ] **T0.1** Repo-Gerüst: TypeScript strict, vitest, eslint, AGENTS.md, epics/-Ordner nach custom-rag-Hygienestandard
- [ ] **T0.2** SQLite-Schema + Migration-Runner (sessions, device_tokens, config)
- [ ] **T0.3** EventStore: append-only JSONL pro Session, fsync-Policy, Blob-Verlagerung, `replay(session_id)`-Funktion
- [ ] **T0.4** SessionManager: Lifecycle (create/park/stop), State-Machine, Crash-Recovery aus JSONL+Snapshot (K7)
- [ ] **T0.5** tmux-Wrapper: spawn/kill/list, attach-Command-Generierung, Orphan-Reaping bei Daemon-Start
- [ ] **T0.6** Adapter-Contract-Interface + Dummy-Adapter (konfigurierbare Event-Raten 1–100/s, alle Event-Typen, kontrollierbare Riesen-Outputs)
- [ ] **T0.7** HTTP/WS-Server: `/api/sessions`, `/api/events/:id/tail`, Auth-Middleware (Tailnet-Identität + Device-Token)
- [ ] **T0.8** Tailscale-serve-Setup-Skript + Doku (kein öffentlicher Port, verify via `tailscale serve status`)
- [ ] **T0.9** PWA-Gerüst: Manifest, Service Worker (Cache letzter Projektion, K10), Dark-Theme, Session-Liste + einfacher Tail
- [ ] **T0.10** WS-Delta-Protokoll: Sequenznummern, Gap-Detection, Resync; drop-on-slow-Queue (max 100 Events gepuffert)
- [ ] **T0.11** `hubctl`-CLI: list/show/tail (Referenz-Client + Debugging)
- [ ] **T0.12** Lasttest-Harness: 20 Dummy-Sessions à 30 Events/s (K8-Vorbereitung)

## 6. Acceptance Criteria (messbar)

- **AC-P0-1 (K7):** Daemon hart gekillt (`kill -9`) während 5 Sessions laufen → nach Restart
  sind alle Sessions mit identischem Status/Event-Count wieder da, Restore < 3 s.
- **AC-P0-2 (K5):** Dummy-Adapter sendet 1 MB Output → JSONL enthält nur Anker-Event
  (< 4 KB) + gültige `blob_ref`; Blob abrufbar und Byte-identisch.
- **AC-P0-3:** PWA erreichbar über `https://<host>.<tailnet>.ts.net`, nicht über LAN-IP;
  Auth ohne gültigen Token → 401.
- **AC-P0-4 (K10):** PWA laden, WLAN am Handy aus → letzte Projektion sichtbar mit Badge
  „Daten vom <Zeitstempel>", kein White-Screen.
- **AC-P0-5:** `hubctl tail <session>` zeigt Events mit < 500 ms Ende-zu-Ende-Latenz.

## 7. Premortem (Pflicht)

**Es ist Ende P0 und das Epic ist gescheitert. Warum?**
1. *WS-Protokoll ohne Gap-Handling gebaut* → PWA zeigt Löcher, Retrospektive teuer. Mitigation: T0.10 vor T0.9 fertigstellen, Tests zuerst.
2. *tmux-Verfügbarkeit auf Zielsystemen* → evox2 hat kein tmux nativ. Mitigation: tmux-Abhängigkeit hinter Interface kapseln, P0 nur Linux-Targets.
3. *fsync-Policy falsch* → entweder Datenverlust bei kill oder I/O-Thrashing bei 30 Events/s. Mitigation: Batch-fsync (alle 100 ms oder 50 Events), Lasttest misst.
4. *Scope-Creep Richtung „erster echter Adapter"* → Mitigation: Review-Gate, Dummy reicht für alle ACs.
5. *PWA-Service-Worker-Cache-Hell* → alte Projektionen werden für aktuelle gehalten. Mitigation: Versioned Cache, Hard-Bust bei Deploy.

## 8. Definition of Done

Alle ACs grün + Contract-Tests Dummy-Adapter grün + `docs/architecture.md` aktualisiert +
kein TODO-Kommentar ohne Ticket-Referenz + Premortem-Mitigationen als Tests abgebildet.
