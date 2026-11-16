# Messlauf — EPIC-P7 (echte Tool-Freigaben, lokales Modell)

**Datum:** 2026-09-23/24 · **Commits:** `feat/p7-t7.2-native-gates`
(claude/ACP/codex), `feat/p7-t7.5-local-models` auf `6cee2d5` (lokales
Modell) · **Werkzeug:** `scripts/messlauf-p7.mjs` · **Messlatten:** AC-P7-1,
AC-P7-2 (K1)

## Aufbau

- **Hub:** workstation (Arch Linux, Node 26.7.0), frischer Test-Hub je Lauf auf
  `127.0.0.1:7399`, `workerRunner: tmux`, Worktree je Session.
- **„Handy“:** das Skript entscheidet über `POST /api/approvals/:id/decide`,
  denselben Weg wie die Freigabe-Karte der PWA.
- **Lokales Modell:** gpubox (AMD Strix Halo, 123 GB Unified Memory),
  llama.cpp b11149 Vulkan als systemd-`--user`-Unit `ancientvoid-llama`, Modell
  `Qwen3-Coder-30B-A3B-Instruct-UD-Q4_K_XL.gguf` (Unsloth, Q4_K_XL), Alias
  `qwen3-coder`, `-c 65536 --parallel 2 -fa on --jinja`, nur auf der
  Tailnet-IP `100.64.0.10:8081` mit API-Schlüssel. Details:
  [`docs/local-llm.md`](../local-llm.md).

## Kommandos

```bash
node scripts/messlauf-p7.mjs claude-gate
node scripts/messlauf-p7.mjs acp-gate copilot
node scripts/messlauf-p7.mjs acp-gate opencode
node scripts/messlauf-p7.mjs codex-gate
LLAMA_KEY=… node scripts/messlauf-p7.mjs local-model opencode
LLAMA_KEY=… node scripts/messlauf-p7.mjs local-model dsh
```

## Ergebnisse — Tool-Freigabe vom Handy (AC-P7-2)

| Harness (Version) | Modell | Fall | gefragt nach | Ergebnis |
|---|---|---|---|---|
| claude 2.1.280 | sonnet | Erlauben: `echo live-ok > erlaubt.txt` | 3016 ms, Status `waiting_approval` | Datei = `live-ok` ✓ |
| claude 2.1.280 | sonnet | Ablehnen: `touch verboten.txt` | — | Datei fehlt, `tool_result.isError` ✓ |
| claude 2.1.280 | sonnet | Rückfrage (AskUserQuestion) → „Grün“ | — | Folge-Bash gefragt und erlaubt, `farbe.txt` = `Grün` ✓ |
| copilot 1.0.88 (ACP) | Standard | Erlauben / Ablehnen | 2514 ms | Datei geschrieben / fehlt ✓ |
| opencode 1.18.32 (ACP) | Standard | Erlauben / Ablehnen | 3517 ms | Datei geschrieben / fehlt ✓ |
| codex 0.156.1 (app-server) | Standard | Erlauben / Ablehnen | 5524 ms | Datei geschrieben / fehlt ✓ |

Erster claude-Lauf fand einen echten Fehler: nach „Ablehnen“ blieb die
Session in `waiting_approval`. Behoben (Tool-Anfragen werden bei Zustellung
abgeschlossen), Regressionstest in `approval-flow`.

## Ergebnisse — lokales Modell durch einen echten Harness (AC-P7-1)

| Harness | Fall | Freigabe | Ergebnis | Dauer (beide Fälle) |
|---|---|---|---|---|
| opencode 1.18.32 (ACP), Provider `@ai-sdk/openai-compatible` | Tool-Erfolg: `echo lokal-ok > lokal.txt` | gefragt nach 14560 ms, erlaubt | Datei = `lokal-ok` ✓ | 46,9 s |
| opencode 1.18.32 (ACP) | Tool-Fehler: `cat /gibt/es/nicht.txt` | gefragt, erlaubt | Fehlermeldung im Ergebnis, Modell erklärt „does not exist“ ✓ | |
| dsh 0.1.5-rc.3 (ACP, `DSH_PERMISSION_MODE=read-only`), pi-ai-Route `gpubox` | Tool-Erfolg: `echo lokal-ok > lokal.txt` | Schreiben scheitert in der Sandbox, dsh fragt nach Eskalation, gefragt nach 13055 ms, erlaubt | Datei = `lokal-ok` ✓ | 31,3 s |
| dsh 0.1.5-rc.3 | Tool-Fehler: `cat /gibt/es/nicht.txt` | Lesen läuft in der Sandbox **ohne** Nachfrage (erwartet) | `No such file or directory`, `[exit code: 1]`; Modell erklärt es ✓ | |

Rohdaten dsh: 2026-09-24T00:57:38Z, beide Fälle `pass: true`.

## Durchsatz des lokalen Modells

`POST /completion`, 16 Prompt-Tokens, 256 erzeugte Tokens, `cache_prompt:
false`, Temperatur 0,7, 3 Wiederholungen, 2026-09-24 ~03:05, gpubox parallel
mit einem zweiten llama-server (Halogen) belegt:

| Lauf | Prompt tok/s | Erzeugung tok/s |
|---|---|---|
| 1 | 164,3 | 84,1 |
| 2 | 180,1 | 82,2 |
| 3 | 167,8 | 82,4 |
| **Median** | **167,8** | **82,4** (Spanne 82,2–84,1) |

Im Agent-Betrieb (≈ 8.400 Tokens Kontext, Server-Log während des
dsh-Laufs): Erzeugung 58 tok/s, Prompt 147–222 tok/s bei kleinen
Nachträgen (Prompt-Cache aktiv).

## Was das nicht sagt

- **Eine Wiederholung je Harness-Fall.** Die Freigabe-Fälle sind
  deterministisch im Hub-Pfad, das Modellverhalten nicht: ein anderes
  Modell kann den Befehl umformulieren (codex setzte `bash -lc` davor).
- **dsh fragt nicht vor jedem Tool.** Mit `read-only` laufen Lese-Befehle
  ungefragt in der OS-Sandbox; gefragt wird, sobald ein Befehl mehr braucht.
  Das ist der dsh-eigene Gate-Typ, dokumentiert in der Harness-Matrix.
- **aider nicht live.** Ein Lauf mit `--yes-always` (aider hat kein
  Tool-Gate) wurde in dieser Umgebung nicht freigegeben; bleibt offen.
- **Kein Seed.** Temperatur und Sampler des Harness bestimmen die Antworten;
  ein Seed wurde nicht gesetzt.
- **Geteilte Maschine.** gpubox betreibt weitere Modelle; `halogen-starten.sh`
  beendet beim Start alle `llama-server` (auch `ancientvoid-llama`). Zahlen gelten
  für den Zustand „beide Server geladen“.
