# ADR-0018 — Harness-Funktionsmatrix und native Freigaben

**Status:** akzeptiert · **Betrifft:** EPIC-P7 T7.1/T7.2,
`packages/contracts/src/adapter.ts`, alle Adapter, `packages/server/src/routes.ts`,
PWA (Start-Dialog, Status-Seite, Session-Ansicht)

## Kontext

`AdapterCapabilities.steer: boolean` sagt nur „nimmt irgendeine Eingabe an“.
Es unterscheidet nicht zwischen Folgeprompt, Unterbrechen, Rückfrage,
Tool-Freigabe, Modellwahl, Skill/Agent, Anhängen und Kontext-Fork (Audit G02,
G08). Die PWA blendet danach Knöpfe ein, und der Server prüft nichts; eine
deaktivierte Oberfläche schützt aber nichts.

Die Hub-Freigabe eines Prompts (ADR-0007) gibt außerdem nicht die einzelnen
Tool-Aufrufe frei, die der Provider danach macht (Audit G07). Heute laufen
Claude mit `--dangerously-skip-permissions`, Copilot mit `--allow-all-tools`
und OpenCode mit `--auto`: Jedes Tool läuft ungefragt.

Live erhoben am 2026-09-23 (Scratch-Versuche, CLI-Versionen in Klammern):

| Harness | Nativer Freigabeweg | Beleg |
|---|---|---|
| claude (2.1.280) | `--permission-prompt-tool mcp__<server>__<tool>`: Claude ruft pro Tool ein MCP-Werkzeug mit `{tool_name, input, tool_use_id}` auf und erwartet `{behavior: "allow", updatedInput}` oder `{behavior: "deny", message}`. `AskUserQuestion` läuft über denselben Weg; die Antwort kommt als `updatedInput.answers`. | Ablehnen: Bash lief nicht, Datei fehlt. Erlauben nach 150 s Wartezeit je Aufruf: läuft. Rückfrage „Rot/Grün“ beantwortet, Datei enthält „Grün“. |
| opencode (1.18.32) | `opencode run` lehnt jede `ask`-Anfrage automatisch ab („auto-rejecting“). Der Plugin-Hook `permission.ask` wird nicht geladen. Nativ nur über `opencode serve` (`/permission/{id}/reply`, `/question/{id}/reply`) oder `opencode acp`. | `run` ohne `--auto`: Tool abgelehnt, niemand gefragt. |
| codex (0.156.1) | `codex exec` kennt keine Rückfrage (nur Sandbox). `codex app-server --listen ws://…` stellt Freigaben als JSON-RPC-Anfragen. | `--help` |
| copilot (1.0.88) | `-p` nur mit `--allow-all-tools` oder `--allow-tool/--deny-tool`. Nativ über `--acp` (Agent Client Protocol, stdio). | `--help` |
| DeepSeek Harness `dsh` (0.1.5-rc.3) | `--profile acp` (ACP über stdio), `--profile sdk` (JSON-RPC), `--profile headless` (nur Endergebnis). | README, `--help` |
| aider (0.86.2) | Keine Tool-Rückfrage im Skriptbetrieb, `--yes-always`. | `--help` |

## Entscheidung

### 1. Feinere Fähigkeiten statt `steer: boolean`

`AdapterCapabilities` bekommt ein Pflichtfeld `features: HarnessFeatures`:

| Feld | Werte | Bedeutung |
|---|---|---|
| `followUp` | bool | Nach einem Zug einen neuen Prompt annehmen |
| `interrupt` | bool | Laufenden Zug anhalten, Session bleibt fortsetzbar (`park`) |
| `toolGate` | `native` · `sandbox` · `allowlist` · `bypass` · `none` | Wie Tool-Aufrufe freigegeben werden (siehe 2.) |
| `questions` | bool | Der Provider stellt Rückfragen, die das Handy beantworten kann |
| `modelChoice` | `start` · `none` | Modell beim Start wählbar |
| `skills` / `agents` | bool | Skill-/Agent-Aufruf (ADR-0005) |
| `images` / `files` | bool | Anhänge an einen Prompt (T7.5) |
| `contextFork` | bool | Session als Abzweig mit Kontext fortsetzen |

`steer` bleibt als Kurzform bestehen (`followUp || interrupt`); alte Leser
brechen nicht.

Die Fähigkeiten hängen von der **Konfiguration** ab, nicht nur vom Adapter:
Claude mit `--dangerously-skip-permissions` ist `bypass`, mit der
Hub-Freigabe `native`. `capabilities()` rechnet das aus der Konfiguration aus.

Optional liefert ein Adapter `models()` (Modellkatalog). Fehlt es, bietet die
PWA ein freies Feld nur bei `modelChoice: "start"`.

### 2. Tool-Gates, ehrlich benannt

- **`native`**: Der Provider fragt den Hub pro Tool-Aufruf. Ablehnen oder
  Zeitablauf führen das Tool nicht aus. Nur diese Stufe erfüllt AC-P7-2.
- **`sandbox`**: Tools laufen ungefragt, aber in einer OS-Sandbox
  (codex `workspace-write`).
- **`allowlist`**: Eine feste Liste beim Start. Was fehlt, wird abgelehnt,
  ohne jemanden zu fragen.
- **`bypass`**: Alles läuft ungefragt. Die PWA zeigt das an der Session als
  Warnung.
- **`none`**: Der Harness hat keine Tools (reiner Modell-Endpunkt).

Kein `bypass` gilt je als Ersatz für `native`. Die Harness-Matrix
(`docs/harness-matrix.md`) nennt je Zelle den Beleg.

### 3. Native Wege je Harness (T7.2)

- **Claude:** Der Hub startet `claude -p` mit `--permission-prompt-tool
  mcp__ancientvoid__permission` und einer `--mcp-config`, die einen kleinen
  stdio-MCP-Server des Hubs startet (`ancientvoid-permission`). Dieser Server stellt
  jede Anfrage per HTTP an den Hub (Session-gebundenes Token) und wartet auf die
  Entscheidung. Der Weg braucht kein stdin und funktioniert deshalb mit tmux
  und nach einem Hub-Neustart (ADR-0014).
- **ACP-Harnesses** (dsh, copilot, opencode): Ein gemeinsamer Adapter
  `acp` spricht das Agent Client Protocol. `session/request_permission` wird
  zur Freigabe, Content-Blöcke tragen Bilder und Dateien. ACP läuft über stdio;
  der tmux-Runner bekommt dafür einen Pipe-Modus (FIFO, den die Pane selbst
  offen hält, damit ein Hub-Neustart kein EOF auslöst).
- **Codex:** `codex app-server --listen ws://127.0.0.1:<port>` in tmux, und der
  Adapter beantwortet die Freigabe-Anfragen. Bis dahin bleibt Codex ehrlich
  `sandbox`.
- **Aider:** Bleibt `bypass`, sichtbar als Warnung.

### 4. Der Server prüft

Jede Eingabe wird gegen die Fähigkeiten der Session geprüft, bevor sie den
Adapter erreicht: Folgeprompt, Park, Modell beim Start, Skill/Agent und
Anhänge. Ein nicht unterstützter Wunsch endet mit **422 und einem deutschen
Satz**, nicht mit einem stillen `ok: false` aus dem Adapter.

## Konsequenzen

- Alle Adapter und Beispiele müssen `features` angeben (Contract-Änderung,
  Testkit prüft die Form).
- Die Status-Seite und der Start-Dialog zeigen die Fähigkeiten und warnen bei
  `bypass`.
- Die Umstellung von Claude auf `native` ändert das Verhalten: Ohne Antwort
  läuft ein Tool nach dem Zeitablauf nicht. Die Freigabe-Zeit für
  Tool-Anfragen ist deshalb getrennt und länger als die 60 s für Hub-Prompts
  (Standard 10 min).
