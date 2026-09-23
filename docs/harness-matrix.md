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
| codex | 0.156.1 | ✓ | ✓ | sandbox | — | ✓ | — | — | — | — |
| opencode | 1.18.32 | ✓ | ✓ | allowlist | — | ✓ | ✓ | — | — | — |
| copilot | 1.0.88 | ✓ | ✓ | bypass | — | ✓ | ✓ | — | — | — |
| aider | 0.86.2 | — | ✓ | bypass | — | ✓ | — | — | — | — |
| cursor-clip | Cursor state.vscdb | — | — | none | — | — | — | — | — | — |
| claude-clip | Transcript JSONL | — | — | none | — | — | — | — | — | — |
| dummy | — | ✓ | ✓ | none | — | — | — | — | — | — |
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
- **codex:** `codex exec resume` für Folgeprompts (`test/fixtures/resume.jsonl`).
  `exec` fragt nie; Tools laufen in `workspace-write`. `danger-full-access`
  macht daraus `bypass`.
- **opencode:** `--session` für Folgeprompts (`test/fixtures/*.jsonl`), `--agent`,
  Modellkatalog `opencode models` (15 Modelle am 2026-09-23). `opencode run`
  lehnt `ask` automatisch ab, niemand wird gefragt (Live-Versuch 2026-09-23).
  `--auto` macht daraus `bypass`.
- **copilot:** läuft im Skriptbetrieb nur mit `--allow-all-tools`
  (`test/fixtures/tool-*.jsonl`).
- **aider:** Folgeprompt nicht verdrahtet (`steer(prompt)` lehnt ab), `--yes-always`.
- **cursor-clip / claude-clip:** nur lesend, siehe jeweilige Adapter-Tests.

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
