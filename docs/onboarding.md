# Onboarding — frischer Klon bis laufender Hub

Zielgruppe: **Menschen und Agenten**, die das Repo neu klonen und ohne
Anpassungen am Code zum Laufen bringen wollen — inklusive Anbindung eigener
Provider, Harnesses, Loops und Factories. Diese Seite ist die Route durch die
Detail-Doks; sie dupliziert sie nicht.

## 0. Was ist fertig, was nicht (ehrlich)

| Baustein | Status nach frischem Klon |
|---|---|
| Provider (OpenAI-kompatibel, eigene Adapter) | **fertig** — nur Endpunkt/Key eintragen |
| Klassische Harness-Adapter (claude, codex, cursor-clip, pi, aider, hermes, …) | **fertig** — CLI installieren, Config-Eintrag |
| ACP-Harnesses (copilot, opencode, dsh, maki, omp) | **fertig** — Preset, CLI installieren ([`adapters.md` §ACP](adapters.md)) |
| Session-Discovery/Übernahme (pi, oh-my-pi, maki) | **fertig** (P22/P24) |
| Loops (P19, `packages/loops/*`) | **fertig** — Onboarding je Loop in dessen Package |
| Factory-Integration (P26) | **offen** — Treiber/Beobachter-Lauf per API ist nicht umgesetzt (T26.5+), Stand in [`epics/EPIC-P26-factory-integration.md`](../epics/EPIC-P26-factory-integration.md) |
| Slash-Command-Brücke (maki live) | **offen** — [BUG-0079](../bugs/bug-0079-maki-slash-bridge-fuehrt-commands-nicht-aus.md) |
| MCP-Gateway-Sidecar | **optional, default aus** — [`apps/gateway-mcp/README.md`](../apps/gateway-mcp/README.md) |
| Multi-Host-Fleet (P6) | teilweise — siehe [Audit](remote-control-audit-2026-09-21.md) |

## 1. Voraussetzungen

- Node ≥ 22.5 (strip-types, kein Build-Schritt für Server-Code)
- git; optional tmux (Worker-Runner, Fallback `process`)
- Für Handy-Zugriff: Tailscale (Exposen **nur** via `tailscale serve`, nie Port öffnen)
- Für E2E-Gates: Playwright-Chromium (fehlt es, skippen E2E-Tests sichtbar)

## 2. Installieren

**Normalweg (ein Befehl, EPIC-P53):** `./setup.sh` — der Wizard prüft
Voraussetzungen, bindet als ersten Schritt den ersten Provider an, installiert,
baut die PWA, stellt ein Device-Token aus und startet den Hub (idempotent,
failt laut; Flags im Skript-Kopf; Hilfe: Skill `setup-wizard`). Die Schritte
3–5 unten erledigt er automatisch.

Manuell (Agenten/CI):

```bash
git clone <repo> && cd AncientVoid
npm install          # richtet auch den commit-msg-Hook ein
npm test             # Sanity: Suite muss grün sein (skips ok)
```

## 3. Konfigurieren

```bash
cp apps/hub/hub.config.example.json hub.config.json
```

- Details/Felder: [`configuration.md`](configuration.md). Eigene Config ist
  git-ignored — **keine Secrets committen**.
- API-Keys gehören in Dateien und werden per `envFiles` referenziert
  (Beispiel maki: `"envFiles": { "ZHIPU_API_KEY": "~/.config/ancientvoid/glm-coding.key" }`)
  — Schlüssel stehen so nie in der Config.
- Alternativer Config-Pfad: `ANCIENTVOID_CONFIG=<pfad>`.

## 4. PWA bauen und starten

Der Wizard (`./setup.sh`) macht beides. Manuell:

```bash
npm -w @ancientvoid/pwa run build     # einmalig (config.server.pwaDir)
node apps/hub/src/main.ts      # Manuell
```

Als Dienst (`~/.config/systemd/user/ancientvoid-hub.service`, minimal):

```ini
[Unit]
Description=AncientVoid
[Service]
WorkingDirectory=<checkout>
ExecStart=<node> apps/hub/src/main.ts
Restart=on-failure
[Install]
WantedBy=default.target
```

Bereit ist der Hub, wenn `GET /api/health` und `/api/ready` grün antworten.

## 5. Verbinden

- **PWA:** `http://127.0.0.1:7373` (port wie config). Von unterwegs: Tailscale +
  `ANCIENTVOID_EXPOSE=1`-Hinweis in [`configuration.md` §Tailscale](configuration.md).
- **CLI:** `ANCIENTVOID_TOKEN=<device-token> node apps/hubctl/src/cli.ts sessions`

## 6. Eigene Tools anbinden (nichts am Code ändern)

1. **Beliebiger OpenAI-kompatibler Endpunkt** (llama.cpp, LM Studio, Ollama,
   vLLM): Beispiel-Adapter registrieren —
   [`examples/adapters/openai-compat/`](../examples/adapters/openai-compat/),
   nur `baseUrl`/`model` in der Config.
2. **Harness-CLI** (Agent x deiner Wahl): Config-Eintrag wie in
   [`README.md` §„Eigene Endpunkte anbinden"](../README.md); welche CLI-Version
   welchen Funktionsumfang liefert, steht in [`harness-matrix.md`](harness-matrix.md).
   ACP-fähige Harnesses brauchen **keinen eigenen Adapter** — Preset genügt
   ([`adapters.md` §„ACP-Harnesses ohne eigenen Code"](adapters.md)).
3. **Laufende Sessions** von pi/oh-my-pi/maki werden erkannt und können
   übernommen werden (Discovery, P22/P24) — nichts einzutragen.
4. **Loops/Factories:** Loop-Pakete (`packages/loops/*`) mitbringen bzw. per
   Config referenzieren. Die Factory-Steuerung aus AncientVoid heraus ist P26 und
   **noch nicht** schaltbar (siehe Tabelle oben).

## 7. Als Agent beitragen (PR-Workflow)

Agenten folgen [`AGENTS.md`](../AGENTS.md) und
[`CONTRIBUTING.md`](../CONTRIBUTING.md):

1. Branch pro Aufgabe (`feat/…`, `fix/…`, `docs/…`), niemals direkt auf `main`.
2. Gates vor dem MR: `npm test`, `npm run lint`, `npm run typecheck`; bei
   UI-/Ablaufsänderungen `npm run test:e2e`; vor Epic-Abschluss `npm run gate`.
3. Commit-Notation `<Risiko> <Absicht> <bereich>: <Satz>` —
   [`docs/commit-notation.md`](commit-notation.md) (Hook prüft).
4. MR via `glab mr create` (Beschreibung: Warum/Änderung/Testplan), Merge nur
   über `glab mr merge`/UI, danach Source-Branch lokal+remote löschen.

## 8. Verifizieren und bekannte Stolpersteine

- `npm run gate` deckt alles ab (inkl. `check:arch`, `check:adapter-matrix`,
  E2E).
- `npm run check:workspace-links` meckert in Session-Worktrees über Pakete des
  Haupt-Checkouts → `node scripts/check-workspace-links.mjs --fix` (BUG-0069).
- Coverage-Zahl: `npm run test:coverage`.
- Hub-Neustart und Worker: Wiederanlauf ist K7-gesichert; Details zu
  Unterbrechungen in [`epics/EPIC-P27-interrupted-sessions.md`](../epics/EPIC-P27-interrupted-sessions.md).
