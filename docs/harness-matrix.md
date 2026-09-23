# Harness-Matrix (ADR-0018)

Was jede Session eines Harness wirklich kann. Das ersetzt „Steer vorhanden“.
Die Spalten entsprechen `capabilities().features` bei **Standard-Konfiguration**
des Adapters. `npm run check:adapter-matrix` vergleicht diese Tabelle mit dem
Code und bricht bei Abweichung ab.

Zeichen: ✓ kann es, — kann es nicht. Tool-Gate: `native` fragt pro Tool,
`sandbox` Tools in OS-Sandbox ohne Nachfrage, `allowlist` feste Liste ohne
Nachfrage, `bypass` alles ungefragt, `none` keine Tools unter Kontrolle
dieser Session.

<!-- harness-matrix:start -->
| Adapter | geprüfte CLI | Folgeprompt | Anhalten | Tool-Gate | Rückfragen | Modellwahl | Agenten | Bilder | Dateien | Abzweig |
|---|---|---|---|---|---|---|---|---|---|---|
| claude | 2.1.280 | ✓ | ✓ | native | ✓ | ✓ | ✓ | — | — | — |
| codex | 0.156.1 `app-server` | ✓ | ✓ | native | ✓ | ✓ | — | — | — | — |
| opencode | 1.18.32 | ✓ | ✓ | allowlist | — | ✓ | ✓ | — | — | — |
| copilot | 1.0.88 | ✓ | ✓ | bypass | — | ✓ | ✓ | — | — | — |
| aider | 0.86.2 | — | ✓ | bypass | — | ✓ | — | — | — | — |
| cursor-clip | Cursor state.vscdb | — | — | none | — | — | — | — | — | — |
| claude-clip | Transcript JSONL | — | — | none | — | — | — | — | — | — |
| dummy | — | ✓ | ✓ | none | — | — | — | — | — | — |
| acp · copilot | 1.0.88 `--acp` | ✓ | ✓ | native | — | — | — | — | — | — |
| acp · opencode | 1.18.32 `acp` | ✓ | ✓ | native | — | — | — | — | — | — |
| acp · dsh | 0.1.5-rc.3 `--profile acp` | ✓ | ✓ | native | — | — | — | — | — | — |
<!-- harness-matrix:end -->

## Belege je Zeile

- **claude:** Folgeprompt/Anhalten über `--resume` bzw. Prozessende:
  `packages/adapters/claude/test/adapter.test.ts` gegen echte Captures
  (`test/fixtures/*.jsonl`), E2E `session.spec.ts`. Modellwahl: Kürzel aus
  `claude --help` (2.1.280). Agent: `--agent` (ADR-0005). Tool-Gate
  `native` (T7.2): `--permission-prompt-tool` über die MCP-Brücke des Hubs,
  Rückfragen (`AskUserQuestion`) auf demselben Weg — Hub-Integration
  `apps/hub/test/modules/approvals/tool-permissions.test.ts`, Brücke
  `apps/gateway-mcp/test/permission.test.ts`, E2E `harness.spec.ts` (Erlauben,
  Ablehnen, Rückfrage). `permissionPrompts: "off"` → `allowlist`,
  `--dangerously-skip-permissions` → `bypass`.
- **codex:** Standard ist seit T7.2 `mode: "app-server"` — ein dauerhafter
  `codex app-server` je Session: Befehle und Dateiänderungen fragen vorher
  (`approvalPolicy: "untrusted"`, nie „für die Session erlauben“), Rückfragen
  (`request_user_input`), Modellkatalog (`model/list`), Kontingent
  (`account/rateLimits`, 5 h und 7 Tage). Belege: `test/app-server.test.ts`
  (nachgebauter app-server, echtes v2-Protokoll), Live-Messlauf
  `scripts/messlauf-p7.mjs codex-gate` mit codex-cli 0.156.1 — Erlauben schreibt
  die Datei, Ablehnen verhindert sie (2026-09-24). `mode: "exec"` bleibt:
  ein Prozess pro Zug, fragt nie, Tools in `workspace-write` (`sandbox`).
- **opencode:** `--session` für Folgeprompts (`test/fixtures/*.jsonl`), `--agent`,
  Modellkatalog `opencode models` (15 Modelle am 2026-09-23). `opencode run`
  lehnt `ask` automatisch ab, niemand wird gefragt (Live-Versuch 2026-09-23).
  `--auto` macht daraus `bypass`.
- **copilot:** läuft im Skriptbetrieb nur mit `--allow-all-tools`
  (`test/fixtures/tool-*.jsonl`).
- **aider:** Folgeprompt nicht verdrahtet (`steer(prompt)` lehnt ab), `--yes-always`.
- **cursor-clip / claude-clip:** nur lesend, siehe jeweilige Adapter-Tests.
- **acp (T7.2):** ein Adapter für jeden Agent-Client-Protocol-Harness,
  dauerhafter Agent-Prozess (tmux-Pipe-Modus), `session/request_permission` →
  Handy, nie „immer erlauben“. Belege: `packages/adapters/acp/test/*`
  (echter Agent-Prozess, Vertrags-Suite), E2E `harness.spec.ts` (Freigabe,
  Übernahme nach SIGKILL), Live-Messlauf `scripts/messlauf-p7.mjs acp-gate`:
  **copilot 1.0.88** und **opencode 1.18.32** — Erlauben schreibt die Datei,
  Ablehnen verhindert sie (2026-09-24). Das opencode-Preset setzt
  `permission: ask` für edit/bash/webfetch, sonst würde opencode ungefragt
  ausführen. **dsh:** Abnahme mit lokalem Modell in T7.5.

## Live-Konfiguration auf omarchy (Stand 2026-09-23)

Der Heim-Hub weicht von der Standard-Konfiguration ab: claude mit
`--dangerously-skip-permissions` und opencode mit `--auto` laufen dort als
`bypass`. Die PWA warnt beim Start und auf der Status-Seite. Claude kann
`native` laufen, sobald das Skip-Flag aus `hub.config.json` entfernt ist
(Umstellung nach dem Live-Messlauf, T7.2).

## Nicht in der Tabelle

- `deepseek`/`local-llm` über `examples/adapters/openai-compat`: Modell-Endpunkt
  ohne Tools (`toolGate: none`), kein Coding-Harness. Der DeepSeek-Harness `dsh`
  kommt mit T7.2/T7.5 über ACP.
- `swarm`: kommt mit T7.5.
