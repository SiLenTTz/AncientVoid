# UACC — Unified AI-Agent Command Center

**mobile-hub** ist ein local-first, vendor-neutrales Command Center: alle
Coding-Agenten auf allen eigenen Rechnern vom Handy aus überwachen, steuern
und auditieren — über Tailscale, ohne öffentlichen Port, ohne Cloud.

> Basis: PRD UACC v1.0 (12.09.2026) — siehe [`epics/`](./epics/).
> Status: **P0 (Hub-Kern)** umgesetzt. Adapter `claude`/`codex` (P1),
> Diff/Approvals/Budgets (P2), Sprach-Features + Adapter-Flotte (P3),
> Brain/Windows/MCP-Gateway (P4) folgen.

## Modularität — das Kernversprechen

Alles ist über Verträge (Contracts) gesteckt, nichts ist im Hub hartverdrahtet:

| Baustein | Package | Erweiterbar durch |
|---|---|---|
| Verträge (Events, Adapter, Worker, WS-Protokoll) | `@uacc/contracts` | — (Stabilitätsgarantie) |
| Hub-Kern (EventStore, Sessions, Registry, DB) | `@uacc/core` | interne Erweiterung via ADR |
| Worker-Runner (tmux / child_process) | `@uacc/workers` | eigene Runner (WSL, remote, …) |
| **Adapter** (Provider, Coding-Tools, lokale Modelle) | `@uacc/adapter-*` | **eigene Endpunkte — s. unten** |
| Adapter-Testkit (Contract-Tests) | `@uacc/adapter-testkit` | — |
| Daemon (REST/WS, Auth, PWA-Serving) | `@uacc/server` | — |
| CLI-Referenzclient | `@uacc/hubctl` | — |
| PWA (dark-first, offline-tolerant) | `@uacc/pwa` | — |

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

| Adapter | Typ | Reasoning | Tools | Cost | Steer | Status | Phase |
|---|---|---|---|---|---|---|---|
| `dummy` | synthetisch | ✓ | ✓ | — | ✓ | proven | P0 |
| `claude` | CLI (stream-json) | ✓ | ✓ | ✓ | ✓ | unproven | P1 |
| `codex` | CLI (exec JSON) | ✓ | ✓ | ~ | ✓ | unproven | P1 |
| `copilot` | CLI + SDK | ~ | ✓ | ~ | ~ | unproven | P3 |
| `swarm` | eigene Event-API | ✓ | ✓ | ✓ | ✓ | geplant | P3 |
| `zai` | API-Router :8788 | ✓ | ✓ | ~ | ✓ | geplant | P3 |
| `local-llm` | OpenAI-kompatibel | ✓ | — | — | ✓ | Vorlage bereit | P3 |
| `cursor-clip` | state.vscdb (read-only) | ~ | — | — | **nein** | may-break | P3 |

(Ehrlichkeitsklausel: Status wird erst nach bestandenen Contract-Tests auf „proven" gesetzt.)

## Quick Start

```bash
node --version          # >= 22.5 (node:sqlite); entwickelt unter Node 26
npm install
npm test                # 36 Tests inkl. Contract-, K5-, K7-Suiten
npm run lint && npm run typecheck

# Hub starten
cp packages/server/hub.config.example.json hub.config.json
node packages/server/src/main.ts            # lauscht auf 127.0.0.1:7373

# Device-Token ausstellen (einmalig sichtbar)
node packages/hubctl/src/cli.ts token issue "pixel-9" --db data/hub.db

# Session erzeugen / tailen
UACC_TOKEN=<token> node packages/hubctl/src/cli.ts sessions
UACC_TOKEN=<token> node packages/hubctl/src/cli.ts tail <sessionId> -f

# PWA bauen (wird vom Hub unter / ausgeliefert, sobald gebaut)
npm -w @uacc/pwa run build

# Fürs Handy: über Tailscale serve exponieren (kein öffentlicher Port!)
scripts/setup-tailscale-serve.sh
```

## Messlatten (Auszug, PRD §9)

| ID | Metrik | P0-Umsetzung |
|---|---|---|
| K5 | Event-Payload ≤ 4 KB, Rest in Blobs | EventStore-Kappung + `blob_ref`, Property-getestet |
| K7 | kill -9 → 100 % State-Restore < 3 s | JSONL-Replay + Snapshot + `adapter.recover()` |
| K8 | 20 Sessions × 30 ev/s ohne Verlust | `npm run loadtest` (grün: 605 ev/s aggregiert) |
| K10 | PWA offline: letzte Projektion + Zeitstempel | Service Worker mit `X-UACC-Cached-At` |

## Sicherheit (PRD §8)

- Kein öffentlicher Port — Loopback-Bind + `tailscale serve`.
- Device-Token-Auth (SHA-256-Hashes in SQLite), optional Tailnet-Identitätszwang.
- Agenten-Output ist für die PWA **Daten**, niemals Instruktion.
- Freie Shell vom Handy: nein — nur registrierte Adapter-Operationen.

## Lizenz

MIT (Disposition in P4 final; s. PRD OD-Punkte). Bis dahin: alle Beiträge unter MIT.
