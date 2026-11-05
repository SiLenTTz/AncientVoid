# Vergleichsanalyse: Paseo (getpaseo/paseo) vs. AncientVoid (ex-UACC)

**Datum:** 05.11.2026 · **Verfasser:** Hermes Agent
**Datenquellen:**
- Paseo: GitHub API live (05.11.2026), paseo.sh Sitemap + 140 Doc-Pages, README + package.json je Workspace (raw.githubusercontent)
- AncientVoid: Tiefenanalyse vor Ort in `/mnt/omarchy_data/30_repos/arch/arbeitsbaeume/AncientVoid` (Subagent, 250 Tool-Calls: README, AGENTS.md, docs/adr 0001–0048, epics/, bugs/, data/, alle package.json, LOC-Zählung)

---

## 0. Executive Summary

Paseo und AncientVoid lösen **verschiedene Probleme mit überlappendem Kern**: Beide orchestrieren Coding-Agenten auf eigenen Maschinen mit Mobile-Zugriff — aber Paseo ist eine *agentic Development Environment* (Editor, Terminals, Diffs, PRs, Browser im Fenster), während AncientVoid eine *Agent Control Plane* ist (Monitoring, Steuerung, Auditing, Approvals, Loops über alle Provider hinweg).

**Urteil in einem Satz:** Paseo gewinnt Ökosystem, Workflow-Integration (Editor/Diff/PR/Browser) und Distribution; AncientVoid gewinnt Architekturdisziplin (Contracts-first, ehrliche Capability-Matrix), Sicherheits- und Kosten-Features (Approvals, Gatekeeper, Quotas) und Prozessreife (49 ADRs, Epic-Gating, Testpyramide). Beide sind auf der jeweils anderen Achse schwach.

**Wichtigste Adoptionskandidaten für AV (Details §5):** Worktree-First-Workflow (paseo.json/.worktreeinclude/Port-Allokation — AV hat hier eine dokumentierte Lücke), funktionierende CI, Plugin-Manifest+Registry, native Mobile-App als optionaler Client, englischsprachige Public Docs. **Keine** Übernahme nötig bei: ACP (hat AV schon als Adapter), Provider-Unabhängigkeit (AVs Contracts-Ansatz ist reifer), Security-Modell (AV ist stärker).

---

## 1. Paseo — Faktenbasis [Certain, live erhoben]

### 1.1 Metriken

| Metrik | Wert |
|---|---|
| Repo | github.com/getpaseo/paseo |
| Stars / Forks | 23.167 / 2.839 |
| Erstellt | 13.10.2025 — in ~12 Monaten zu 23k Stars |
| Letzter Push | 05.11.2026 (heute), täglich aktiv |
| Lizenz | Apache-2.0 |
| Team | 1 Solo-Maintainer (boudra) + Sponsoren (Hoplite u.a.), „tens of thousands of developers daily" |
| Codegröße | TypeScript 45,0 MB (GitHub-Sprachstatistik, inkl. Alles), Kotlin/Swift für native Mobile-Anteile |

### 1.2 Monorepo (npm workspaces)

| Package | Zweck | Kern-Tech |
|---|---|---|
| `server` | Daemon: Agent-Orchestrierung, WebSocket-API, MCP-Server | express, ws, node-pty, xterm-headless+serialize, zod, pino, sherpa-onnx (lokales STT) |
| `desktop` | Desktop-App | Electron-Wrapper um Web-App |
| `app` | **Volle native Mobile-App** | Expo/React Native, CodeMirror-Editor, expo-sqlite, i18next |
| `cli` | Fernsteuerung | `paseo run/ls/attach/send --host workstation:6767` |
| `client` | TS-SDK `@getpaseo/client` | für Integrations/Dashboards |
| `protocol` | Wire-Types | geteilt Client/Server |
| `relay` | E2E-Relay für Device-Pairing | **separat in Elixir** |
| `plugin` | Plugin-API daemon-seitig | Registry, Hooks, Provider-Erweiterung |

**Entscheidend im Server-Deps:** `@agentclientprotocol/sdk` (ACP), `@anthropic-ai/claude-agent-sdk`, `@opencode-ai/sdk`, `openai`, `@modelcontextprotocol/sdk` — Provider-Anbindung primär über offene Protokolle, nicht Eigenbau-Adapter.

### 1.3 Features (140 Doc-Pages)

- **30+ Agent-Provider** über native Support-Liste + ACP-Katalog
- **Git-Worktrees first-class**: Worktree pro Agent, `.worktreeinclude` (Dateien kopieren), `paseo.json` (Workspace-Manifest), dynamische Port-Allokation, Setup/Teardown-Skripte, Services pro Workspace
- **Agent-IDE**: Editor, Terminals, Diff-Review, PR-Erstellung, eingebauter Browser (`browser-when`: bedingte Browser-Nutzung)
- **Hub**: Trigger-Orchestrierung (GitHub/Slack/Discord), self-hostbar inkl. eigener Apps
- **Plugins**: daemon-seitig, `paseo plugin add owner/slug` (Registry), Git/local-Install, in jedem Client gleiche UI
- **Schedules** (Cron-ähnlich, „Keep run workspaces")
- **Voice**: lokal (sherpa-onnx) oder OpenAI; **Skills** wie `/paseo-committee` (2 konträre Agenten → RCA)
- **Security-Doku**: „Why the relay can't attack you", Trust-Modell, Alternativen Direkt/TCP/Tailscale
- **Zero Telemetry**, keine Logins erzwungen; Docker + Nix; 4-sprachiges README; VS-Code-Extension; App Store + Play Store

---

## 2. AncientVoid — Tiefenanalyse [Certain, vor Ort verifiziert]

### 2.1 Positionierung

„Local-first, vendor-neutrales Command Center": alle Coding-Agenten auf allen eigenen Rechnern vom Handy aus überwachen, steuern, auditieren — über Tailscale, ohne öffentlichen Port, ohne Cloud. Basis: PRD v1.0 (12.09.2026) mit Messlatten K1–K10 und **Epic-Gating** (P(n) startet erst bei grünen Exit-Kriterien von P(n-1)); P0–P4.5 gebaut, MRs bis !200 deployed. Umbenennung UACC→AncientVoid via ADR-0046/0047.

### 2.2 Architektur

npm-workspaces Monorepo, **TypeScript 6.0 strict, 100% ESM, Node ≥22.5** — Server-Code **ohne Build-Schritt** (Node strip-types; deshalb keine Enums/Namespaces, `.ts`-Import-Suffixe). PWA baut via Vite.

**APPS:**
- `apps/hub` — Daemon (@ancientvoid/server): Fastify + @fastify/websocket + ws, zod, @simplewebauthn/server (Passkeys); liefert REST/WS + PWA-dist
- `apps/pwa` — Mobile-First UI: **Preact** + Vite (bewusst klein), QR-Pairing für Device-Tokens
- `apps/hubctl` — Referenz-CLI (list/show/tail/tokens), via npx tsx, deps nur contracts/core/workers
- `apps/gateway-mcp` — MCP-Sidecar: exposet den Hub via 3 Meta-Tools (hub_search/hub_describe/…) für beliebige MCP-Clients
- `apps/companion` — Desktop-Companion (ADR-0031): tippt Diktate ins Zielfenster, dep nur contracts

**PACKAGES:**
- `contracts` — nur zod: Events-, Adapter-, Worker-, WS-Protokoll-Verträge; **explizite API-Stabilitätsgarantie**; Module für approvals/attachments/commands/fleet/loops/media/notifications/observability/push/reporting/runs/sessions/voice
- `core` — Hub-Kern: EventStore, SessionManager, Registry; **node:sqlite (WAL-Mode)** — null native Module; 21 Module (approvals, gatekeeper, handover, identity, loops, fleet, skills, workspace, …)
- `workers` — Runner tmux + child_process (tmux.ts, process.ts, orphans.ts)
- `models` — kuratierte Context-Window-Tabelle pro Modell (ADR-0032)
- `loops/aspark-factory` + `loops/securesight-factory` — autonome Loop-Pakete („dark factory", ADR-0038)
- `adapters/` — **14 Adapter**: acp, aider, claude, claude-clip, codex, copilot, cursor, cursor-clip, dummy, hermes, jsonrpc, opencode, pi, testkit

**Nicht verhandelbare Regeln (AGENTS.md):** Contracts first; Adapter sehen nur AdapterContext (emit, blob, spawnWorker, log, signal, workdir, sessionId), importieren nie core/server; Event-Payloads ≤4 KB, Großes via ctx.blob(); Zustand aus JSONL+Snapshot rekonstruierbar; Fail loud.

### 2.3 Feature-Set (Auswahl mit ADR-Belegen)

- **Sessions**: Identity/Discovery (0011), Park-Reason (0008), Handover (0039), interrupted-Status (0044), KI-Titel (0035), Modus+Modell pro Session (0033), Token/Cost-Aggregation (0006/0003), Resume-Referenzen (0036)
- **Loops**: Treiber/Beobachter-Integration (0043), Treiberwahl+Projektpfad (0048), Onboarding-Prefill (0045)
- **Workers**: Orphan-Erkennung, stabile Marker (0037), Recovery adoptiert Provider-Worker (0014), Turn-State aus Worker-Lifecycle (0013)
- **Bridges**: `data/bridges/<uuid>.mcp.json` — **28 live MCP-Bridge-Instanzen**; plus gateway-mcp in Gegenrichtung → **MCP in beide Richtungen**
- **Adapter-Matrix (ehrlich, live verifiziert)**: proven = dummy, codex (app-server JSON-RPC), opencode (--format json), copilot (CLI 1.0.86), pi (headless, MR !200), cursor-clip (read-only), claude-clip (read-only), hermes (Resume live seit 03.10.); unproven/Vorlage = aider, deepseek, local-llm, swarm
- **Governance**: Approval-Service (0007, durable ops 0019), Tool-Gatekeeper (0024), Account-Level-Quotas (0004), Honest Metrics (0023)
- **Weiteres**: Web-Push (0026), lokale STT inkl. Streaming (0028/0032), Slash-Commands (0042), Shared-Drafts (0025), **Fleet/Home-Hub-Aggregator** für mehrere Maschinen (0017), Workspace-Modul + apply-session-work-to-project (0016)
- **Security**: Passkeys/WebAuthn, Device-Tokens nur als Hash, Exposition nur via Tailscale serve, Prompt-Injection-Grenze (PRD §8.5), Actor-Policy (0021)

### 2.4 Speicherung (`data/`, git-ignored)

hub.db (node:sqlite, WAL; Altlast uacc.db), sessions/ (122 Session-Dirs), loops/ (Loop-State-JSON), workers/ (.log + .log.offset Tail-Marker), bridges/ (28 .mcp.json), attachments/ (14), media/, backups/ (Pre-Epic-Snapshots), worktrees/.

### 2.5 Qualitätsinfra

- **164 vitest-Dateien** (Unit/Contract/Integration), **47 Playwright-E2E-Specs** gegen echten Hub (auth, steer, loops, fleet, handoff, voice-local, messlauf-p8 …) + live-Specs; test:phone, loadtest (K8: 20 Sessions × 30 events/s), Messlauf-Skripte (approve-latency, hubctl-latency)
- **Adapter-Testkit**: Contract-Suite pro Adapter, grün = hub-integrierbar — Skips gelten nicht als Pass (ADR-0002)
- **Gates**: `npm run gate` = typecheck+lint+test+e2e, Pflicht vor jedem MR; pre-push-Hooks; Commit-Notation erzwungen
- **Prozess**: 49 ADRs, 34 Epic-Dokumente mit Gating+Premortem-Pflicht, 90 Bug-Reports, check-Skripts (check:arch, check:adapter-matrix …), ponytail-review gegen Überkonstruktion
- **CI: faktisch kaputt** — GitLab-CI Free-Abo unzuverlässig (in AGENTS.md selbst dokumentiert); verbindlich sind nur lokale Gates

### 2.6 Codegröße

~54.000 Zeilen .ts (inkl. Tests), davon ~33.500 reiner Source; e2e/ 53 Dateien; 49 ADRs, 34 Epics, 90 Bugs, 27 docs.

---

## 3. Direkter Vergleich

| Dimension | Paseo | AncientVoid | Besser |
|---|---|---|---|
| Provider-Anbindung | 30+ über ACP/MCP/SDKs | 14 Adapter, 8 proven, Contracts+Testkit | **Unentschieden** — Paseo breiter, AV strenger verifiziert |
| Architektur-Disziplin | Monorepo, solide | Contracts-first, API-Stabilitätsgarantie, Schichtregeln | **AV** |
| Ehrlichkeit über Fähigkeiten | Marketing-nahe Docs | proven/unproven-Matrix je Capability | **AV** |
| Workflow-Integration | Editor, Diffs, PRs, Browser, Terminals | Monitoring/Steuerung/Audit, kein Editor/Diff | **Paseo** (komplette Kategorie fehlt bei AV) |
| Worktrees | First-class (Manifest, Ports, Services) | Workspace-Modul, kein worktree-Layout erkennbar | **Paseo** |
| Mobile | Volle native App (Expo, iOS+Android) | Preact-PWA (bewusst, klein) | **Paseo** (nativ), AV-PWA ist bewusster Trade-off |
| Governance/Sicherheit | Trust-Modell dokumentiert, E2E-Relay | Approvals, Gatekeeper, Quotas, Passkeys, Injection-Grenze, Actor-Policy | **AV** |
| Kosten/Token | — | Aggregation + Quotas + Context-Window-Tabelle | **AV** |
| MCP | MCP-Server im Daemon | Beide Richtungen, 28 live Bridges | **AV** |
| Multi-Maschine | Mehrere Daemons je Client | Fleet-Aggregator (ADR-0017) | **AV** |
| Autonome Langläufer | Schedules (zustandslos) | Loops mit State, Treiber/Beobachter (jung, 1 Live-Instanz) | **AV** (Konzept), beide unreif in der Praxis |
| Erweiterbarkeit | Plugin-Registry + Manifest | examples/, kein Plugin-Format | **Paseo** |
| CI | GitHub-Actions-Skala, täglich Releases | GitLab-CI faktisch kaputt, lokale Gates | **Paseo** |
| Prozess/Docs | CHANGELOG, 4 Sprachen, gut | 49 ADRs, Epic-Gating, Premortem — aber deutsch | **AV** (Tiefe), Paseo (Zugänglichkeit) |
| Community/Distribution | 23k Stars, Sponsoren, Stores | Solo, privat | **Paseo** |

---

## 4. Was besser ist — und warum (begründet)

**Paseo ist besser in:**
1. **Entwickler-Workflow-Komplettität** — AV überwacht/steuert Agenten, aber der Mensch reviewt Diffs und PRs woanders. Paseo hat Editor+Diff+PR+Browser+Terminals in einem Fenster, mobile identisch. Das ist der größte funktionaler Vorsprung.
2. **Distribution & Ökosystem** — Plugin-Registry, native Apps, Stores, Sponsoren. AV hat kein Verbreitungsformat für Dritte.
3. **CI/Release-Dizipline** — täglich Releases auf 23k-Star-Basis; AVs CI ist selbst dokumentiert kaputt.
4. **Worktree-Workflow** — deklaratives Manifest mit Port-Verwaltung und Setup/Teardown.

**AncientVoid ist besser in:**
1. **Vertragsdisziplin** — Contracts-Package mit Stabilitätsgarantie + Adapter-Testkit ist strenger als alles, was Paseo öffentlich anbietet.
2. **Governance** — Approvals, Tool-Gatekeeper, Quotas, Honest Metrics: hat Paseo in dieser Form nicht.
3. **Security-Konkretion** — Passkeys, Token-Hashes, Injection-Grenze, Actor-Policy vs. Paseos dokumentiertem aber schlankem Modell.
4. **MCP-Integration beidseitig** — 28 live Bridges + Sidecar.
5. **Prozesstiefe** — 49 ADRs/Epic-Gating/Premortem schlagen Paseos Release-Dokumentation an Verlässlichkeit.

---

## 5. Empfehlungen für AncientVoid (priorisiert)

**P1 — Worktree-First-Workflow übernehmen.** AV hat selbst eine Lücke (kein worktree-Layout trotz Workspace-Modul). Adoptionsstücke: Workspace-Manifest à la `paseo.json` (Services, Ports, Setup/Teardown pro Worktree), `.worktreeinclude`-Pendant für Dateien, dynamische Port-Allokation. Passt direkt in ADR-0016 (apply-session-work-to-project) und in die Parallel-Session-Story (Jans Erwartung: Loops schließen alles selbst ab).

**P1 — CI reparieren statt akzeptieren.** Paseo beweist: tägliche Releases bei 23k Nutzern funktionieren. Optionen: GitHub Actions Mirror (Repo liegt eh auf GitLab — Runner mieten), self-hosted GitLab Runner auf evox2/bmax. AV hat die Tests (164+47), es fehlt nur verbindliche Ausführung.

**P2 — Plugin-Format für Adapter+Sinks.** Aus `examples/adapters`/`examples/reporting-sinks` ein deklaratives Manifest machen + `hubctl plugin add <git|local>`. Nutzt AVs Contracts-Stärke (Plugin = Contract-Einhaltung via Testkit nachweisbar — das könnte sogar *besser* als Paseos Registry werden, weil maschinell verifizierbar).

**P2 — ACP-Adapter zur Breiten-Düse ausbauen.** Korrektur zur ersten Einschätzung: AV **hat** bereits `adapters/acp`. Aber: aider/deepseek/local-llm/swarm als Einzeladapter pflegen vs. über den ACP-Katalog abdecken — prüfen, ob unproven-Vorlagen durch ACP-Laufzeit-Discovery ersetzt werden können. Paseo beweist den Katalog-Ansatz in Produktion.

**P3 — Native Mobile-App (Expo) als optionaler Client.** Die Preact-PWA bleibt SSOT-UI; eine Expo-Shell mit Web-View + nativen Push/STT/Share wäre additive. Nur wenn eigener Bedarf (Jan: Tablet-Layout-Spec existiert schon).

**P3 — Englische Public Docs, falls je OSS.** 49 ADRs sind ein Asset — aber nur auf Deutsch lesbar. Selbst bei Closed-Source: englische README/CONTRACTS-Übersicht kostet 1 Tag und öffnet jeden späteren OSS-Schritt.

**Bewusst NICHT übernehmen:** Relay-Server (Tailscale serve reicht und ist eine Abhängigkeit weniger), Electron-Desktop (companion ist schlanker), Editor/Diff/PR-Suite als Monolith (wenn, dann via bestehendem gateway-mcp an IDE koppeln), Schedules (Loops sind das stärkere Konzept).

---

## 6. Fazit

Die Tools sind keine Substitute: Paseo ersetzt kein AncientVoid (keine Approvals, keine Quotas, keine Contracts-Garantien, keine Fleet-Aggregation mit Audit) und AncientVoid ersetzt kein Paseo (kein Editor/Diff/PR/Browser-Workflow, keine native App, kein Plugin-Ökosystem). Die ehrliche Einschätzung: **AVs Fundament ist besser gebaut, Paseos Haus ist für Entwickler bewohnbarer.** Die höchstwertigen Übernahmen sind der Worktree-Workflow und eine funktionierende CI — beides adressiert dokumentierte AV-Schwächen mit bewährten Paseo-Blaupausen. AVs Alleinstellungsmerkmale (Governance, Contracts, bidirektionales MCP, Fleet) sollte es dagegen nicht verbiegen.

---
*Erhebungsstand: 05.11.2026, 14:35 CET. Paseo-Metriken live via GitHub API; AV-Daten aus Repo-Analyse (Subagent, vollständige Summary: ~/.hermes/cache/delegation/subagent-summary-0-20261105_142935_921617.txt).*
