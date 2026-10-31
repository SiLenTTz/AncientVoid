# AncientVoid

**AncientVoid** ist ein local-first, vendor-neutrales Command Center: alle
Coding-Agenten auf allen eigenen Rechnern vom Handy aus überwachen, steuern
und auditieren — über Tailscale, ohne öffentlichen Port, ohne Cloud.

> Basis: PRD „AncientVoid“ v1.0 (12.09.2026) — siehe [`epics/`](./epics/).
> **Frisch geklont? Setup-Route: [`docs/onboarding.md`](./docs/onboarding.md)** (Menschen & Agenten, inkl. ehrlicher Fertig-Tabelle).
> Status (Audit 2026-09-21): **Hub-Kern und große Teile von P0–P4 implementiert,
> Produkt-Gates noch offen.** Echte Handy-/Offline-/Push-Abnahmen, Swarm,
> lokale Sprachpipeline, WSL und P4-Integrations-/Release-Aufgaben sind nicht
> vollständig abgeschlossen. Die Markdown-Suche über `qmd` ist keine allgemeine
> Quellcodesuche. MCP-Gateway und Reporting-Sink existieren, die vollständige
> PC↔Handy-Session-Übernahme und Multi-Host-Steuerung noch nicht.
> Siehe [Bestandsaufnahme mit Evidenz und UI-/Laya-Bewertung](docs/remote-control-audit-2026-09-21.md)
> und [Planungs-Epics P5–P12](epics/README.md). Diese sind geplant, nicht umgesetzt.

## Modularität — das Kernversprechen

Alles ist über Verträge (Contracts) gesteckt, nichts ist im Hub hartverdrahtet:

| Baustein | Package | Erweiterbar durch |
|---|---|---|
| Verträge (Events, Adapter, Worker, WS-Protokoll) | `@ancientvoid/contracts` | — (Stabilitätsgarantie) |
| Hub-Kern (EventStore, Sessions, Registry, DB) | `@ancientvoid/core` | interne Erweiterung via ADR |
| Worker-Runner (tmux / child_process) | `@ancientvoid/workers` | eigene Runner (WSL, remote, …) |
| **Adapter** (Provider, Coding-Tools, lokale Modelle) | `@ancientvoid/adapter-*` | **eigene Endpunkte — s. unten** |
| Adapter-Testkit (Contract-Tests) | `@ancientvoid/adapter-testkit` | — |
| Daemon (REST/WS, Auth, PWA-Serving) | `@ancientvoid/server` | — |
| CLI-Referenzclient | `@ancientvoid/hubctl` | — |
| PWA (dark-first, offline-tolerant) | `@ancientvoid/pwa` | — |
| MCP-Gateway-Sidecar (T4.6, default **aus**) | `@ancientvoid/gateway-mcp` | eigene Operationen — s. [dessen README](apps/gateway-mcp/README.md) |

### Eigene Endpunkte anbinden (der normale Weg, kein Fork nötig)

Ein Adapter ist ein Modul mit `createAdapter(config)` — als lokale Datei ODER
npm-Paket. In `hub.config.json` eintragen, fertig:

```json
{
  "adapters": [
    { "id": "my-provider", "module": "./adapters/my-provider/adapter.ts" },
    { "id": "local-llm", "module": "./examples/adapters/openai-compat/adapter.ts",
      "config": { "baseUrl": "http://127.0.0.1:8080/v1", "model": "qwen2.5-coder" } }
  ]
}
```

Vorlage: [`examples/adapters/openai-compat/`](./examples/adapters/openai-compat/) —
funktioniert mit jedem OpenAI-kompatiblen Endpunkt (llama.cpp, LM Studio,
Ollama, vLLM). Anleitung: [`CONTRIBUTING.md`](./CONTRIBUTING.md) und
[`docs/adapters.md`](./docs/adapters.md).

### Adapter-Status-Matrix

Welche Funktion jeder Harness wirklich hat (Folgeprompt, Anhalten, Tool-Freigabe, Rückfragen, Modellwahl, Anhänge): [`docs/harness-matrix.md`](docs/harness-matrix.md) (ADR-0018).

| Adapter | Typ | Reasoning | Tools | Cost | Steer | Kontingent | Status | Phase | Resume (ADR-0036) |
|---|---|---|---|---|---|---|---|---|---|
| `dummy` | synthetisch | ✓ | ✓ | — | ✓ | — | proven | P0 | — |
| `claude` | CLI (stream-json) | ✓ | ✓ | ✓ | ✓ | ✓ | proven | P1 | `claude --resume <id>` |
| `codex` | CLI (`app-server` JSON-RPC, früher `exec`) | ✓ | ✓ | ~ | ✓ | ✓ | proven | P1 | `codex resume <id>` |
| `opencode` | CLI (`--format json`) | ✓ | ✓ | ✓ | ✓ | — | proven | P3 | `opencode --session <id>` |
| `copilot` | CLI (`--output-format json`) | — | ✓ | — | ✓ | — | proven (echte, authentifizierte GitHub-Copilot-CLI 1.0.86 auf dieser Maschine, echte Live-Captures inkl. Tool-Erfolg/-Fehler) | P3 | — |
| `pi` | CLI (`pi -p`, Events+Plaintext) | ✓ | ✓ | — | ✓ | — | proven (pi -p headless live auf omarchy, MR !200; BUG-0066) | P16 | — |
| `swarm` | custom-rag Coding-Swarm REST | ✓ | ✓ | ✓ | ✓ | ? | geplant (Spec real, keine Live-Instanz) | P3 | — |
| ~~`zai`~~ | — | — | — | — | — | — | **entfällt** — real läuft über `opencode` (Provider `zai-coding-plan`) | P3 |
| `local-llm` | OpenAI-kompatibel | ✓ | — | — | ✓ | — | Vorlage bereit (keine lokale Instanz zum Prüfen) | P3 | — |
| `deepseek` | OpenAI-kompatibel (`api.deepseek.com`) | ✓ | — | — | ✓ | — | Vorlage bereit (kein API-Key zum Prüfen) | P3 | — |
| `aider` | CLI (`--message`, Plaintext) | — | ✓ | — | ✓ | — | strukturell gebaut, unproven (kein API-Key/kein realer LLM-Turn hier möglich) | P3 | — |
| `hermes` | CLI (`chat -q --yolo -Q --pass-session-id`, Plaintext) | — | ✓ | — | ✓ | — | built + smoke (echte hermes-Binary auf Zeratul, Session-ID/Resume live verifiziert 03.10.2026) | P13 | `hermes --resume <id>` |
| `cursor-clip` | state.vscdb (read-only) | ✓ | ✓ | — | **nein** | — | proven (echte, live laufende Cursor-Installation auf dieser Maschine, echte SQLite-Reads gegen ihre aktive WAL-Datenbank) — may-break by design (K9) | P3 | — |
| `claude-clip` | Claude-Code-Transcript JSONL (read-only) | ✓ | ✓ | — | **nein** | — | proven (echtes Linux-Transcript-Format, synthetische Datenschutz-Fixtures und Live-Tailing gegen echte Dateien) — may-break by design (K9); beobachtet, übernimmt oder steuert keine externe Session | P3 | — |

Kontingent (`capabilities().usage`, [ADR-0004](docs/adr/0004-account-level-usage-quota.md)):
✓ = liefert real ein Account-Level-Quota-Fenster, — = verifiziert kein
Quota-Signal in der CLI, `?` = noch nicht gebaut/geprüft. Nie geraten (P1.5s
„unbekannt statt geraten"-Regel).

(Ehrlichkeitsklausel: Status wird erst nach bestandenen Contract-Tests auf „proven" gesetzt.)
Die Spalten Reasoning/Tools/Cost/Steer/Kontingent sind gegen jedes Adapters
echten `capabilities()`-Rückgabewert automatisiert geprüft (T3.11):
`npm run check:adapter-matrix` ([`scripts/check-adapter-matrix.mjs`](scripts/check-adapter-matrix.mjs)).
Status/Phase bleiben bewusst manuell — das sind Belege (Tests, Messläufe),
kein reiner Funktionsaufruf.

## Quick Start

```bash
node --version          # >= 22.5 (node:sqlite); entwickelt unter Node 26
npm install
npm test                # alle Packages inkl. Contract-, K5-, K7-Suiten
npm run lint && npm run typecheck

# Hub starten
cp apps/hub/hub.config.example.json hub.config.json
node apps/hub/src/main.ts            # lauscht auf 127.0.0.1:7373

# Device-Token ausstellen (einmalig sichtbar)
node apps/hubctl/src/cli.ts token issue "pixel-9" --db data/hub.db

# Session erzeugen / tailen
ANCIENTVOID_TOKEN=<token> node apps/hubctl/src/cli.ts sessions
ANCIENTVOID_TOKEN=<token> node apps/hubctl/src/cli.ts tail <sessionId> -f

# PWA bauen (wird vom Hub unter / ausgeliefert, sobald gebaut)
npm -w @ancientvoid/pwa run build

# Fürs Handy: über Tailscale serve exponieren (kein öffentlicher Port!)
scripts/setup-tailscale-serve.sh
```

Betrieb, Updates und Rückkehr: [Installations-Runbook](docs/operations-runbook.md).
Verschlüsselte Sicherungen: [Backup/Restore-Runbook](docs/backup-restore.md).

## Messlatten (Auszug, PRD §9)

| ID | Metrik | P0-Umsetzung |
|---|---|---|
| K5 | Event-Payload ≤ 4 KB, Rest in Blobs | EventStore-Kappung + `blob_ref`, Property-getestet |
| K7 | kill -9 → 100 % State-Restore < 3 s | JSONL-Replay + Snapshot + `adapter.recover()` |
| K8 | 20 Sessions × 30 ev/s ohne Verlust | `npm run loadtest` (grün: 605 ev/s aggregiert) |
| K10 | PWA offline: letzte Projektion + Zeitstempel | Service Worker mit `X-AncientVoid-Cached-At` |

## Sicherheit (PRD §8)

- Kein öffentlicher Port — Loopback-Bind + `tailscale serve`.
- Device-Token-Auth (SHA-256-Hashes in SQLite), optional Tailnet-Identitätszwang.
- Agenten-Output ist für die PWA **Daten**, niemals Instruktion.
- Freie Shell vom Handy: nein — nur registrierte Adapter-Operationen.

## Lizenz

MIT (Disposition in P4 final; s. PRD OD-Punkte). Bis dahin: alle Beiträge unter MIT.
