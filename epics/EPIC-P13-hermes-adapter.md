# EPIC-P13 — Hermes-Adapter (CLI) für die Adapter-Flotte

**Status:** abgeschlossen (Ralph-Loop, 2026-10-03 — alle 5 Tasks done, Live-Smoke bestanden) · **Phase:** P13 · **Dauer:** 1 Agenten-Tag · **Abhängigkeit:** P3-Adaptermuster etabliert (aider/opencode als Vorlage); P7 Capabilities.

Auftrag vom 2026-09-03 [sic] — Jan: "Option 1 (Hermes als CLI-Adapter) umsetzen". Hintergrund: Hermes Agent (Nous Research) läuft auf Zeratul; `hermes chat -q "<prompt>" --yolo -Q --pass-session-id [--resume <SID>]` bietet exakt das CLI-Adapter-Interface des Hubs (Query, Exit, Session-ID, Resume). Kerrigan ist ein OpenClaw-Agent — Hermes wird als vollwertiger CLI-Adapter integriert, kein Sonderweg.

## 1. Ziel

Hermes als ersten-Class-Adapter im Hub: Session starten, Prompt senden, Antwort/Events in Verlauf streamen, Resume über Session-ID, sauberes Beenden. 100% austauschbar mit den anderen Adaptern (Jans Regel).

## 2. Scope

**In:** `packages/adapters/hermes/` (Muster: aider — spawnWorker-basiert, 178 LOC Vorlage), capabilities-Deklaration, Adapter-Registry-Eintrag, Unit-Tests (normalize/parsing), README-Doku in `docs/adapters.md`, Live-Smoke-Test gegen echte `hermes`-Binary auf diesem Host.
**Out:** Hermes-Server-Modus, OpenAI-Endpoint-Proxying (das leisten die Provider-Endpunkte), GUI-Fallback, Änderungen an Hermes selbst.

## 3. Design-Details

- Spawn: `hermes chat -q <prompt> --yolo -Q --pass-session-id -t <toolsets>` im Workspace-CWD; Session-ID aus stdout parsen (`session id: <sid>`), persistieren, bei Folgeprompt `--resume <sid>`.
- Modell/Provider optional via `-m`/`--provider` aus `spec.model` (analog aider: ohne spec.model keine Modell-Flags).
- Kein FIM, kein diff-Format — Capabilities ehrlich deklarieren (chat, resume, interrupt via SIGINT/stdin-close).
- Provider-Unabhängigkeit: Adapter macht keine Annahmen über Modelle.

## 4. Tasks

- T13.1 Adapter-Skelett nach aider-Muster + Registry + capabilities
- T13.2 Session-ID-Parsing + Resume-Logik + Unit-Tests
- T13.3 Events → Verlauf (stdout-Zeilen zu hub-events normalisieren)
- T13.4 Live-Smoke: echte hermes-Session im Hub starten, eine Query, Verlauf prüfen, Resume prüfen
- T13.5 Doku (docs/adapters.md + epics/README-Zeile) + Abschlussreport

## 5. Messlatte & DoD

- [x] Unit-Tests grün (Suite 713 → **730 grün** nach P13: +21 hermes-Tests, 21/21, keine Regression — voller Lauf 03.10.2026)
- [x] Live-Smoke: Session `df89fcff-bcfe-4bb7-87f2-072013b380be` in hub.db sichtbar, Events seq 1–6 (assistant sauber), exit 0
- [x] Resume funktioniert: steer(prompt) → `--resume 20261003_204235_fc918c`, Codewort-Rückruf (Kiwi42) in Turn 2 bewiesen
- [x] Commit-Notation eingehalten (5 Commits, Hook-geprüft); Epic-Status final: abgeschlossen
- [x] Push nach Jans Go (GitLab SSH) — Go erteilt 03.10., ausgeführt im Abschluss-Commit

## 6. Abschlussreport (2026-10-03, Ralph-Loop)

**Tasks: 5/5 completed.** Beweise pro Task:

| Task | Beweis |
|---|---|
| T13.1 Skelett+Registry | `packages/adapters/hermes/` (ae2bba5), hub.config.json-Eintrag (lokal, Datei gitignored), Adapter-Registry lädt: Hub-Log `adapters loaded … hermes@0.1.0` |
| T13.2 Session-ID+Resume | 4d61ed4: stderr/stdout-Line-Buffering gegen Chunk-Grenzen, Exit-Flush, Dedup; Unit-Tests mit Chunk-Split/No-EOL/Resume-Dedup |
| T13.3 Events→Verlauf | fb8b98a: Warning-Zeilen vom stdout-Answer getrennt (od -c verifiziert) |
| T13.4 Live-Smoke | Zwei echte Hub-Runs; PTY-Live-Funds gefixt (1e2fb1f: tmux interleaved stdout/stderr + ANSI; 8ec47cd: Resume-Chrome); finaler Run: NOTED → Resume → Kiwi42, exit 0 |
| T13.5 Doku | docs/adapters.md-Sektion, README-Matrix-Zeile, harness-matrix-Zeile, epics/README-Zeile, dieser Report |

**Ehrliche Lücken / Risiken:**

- `reasoning/tools/cost/usage` =Streams existieren in `-Q` nicht — hermes tool-Aktivität ist im Verlauf unsichtbar (nur Endantwort). Struktur passt zu aider/claude-precedent, aber wer Tool-Transparenz will, braucht hermes-seitigen Event-Support (out of scope, siehe §2).
- Der Warning-/Status-Line-Filter ist Präfix-Heuristik (`Warning: `, `↻ Resumed session `, `Model restored from session: `) — ein Modell, das eine Antwortzeile zufällig so beginnt, würde diese Zeile verlieren. Dokumentierter Trade-off.
- `hub.config.json` ist gitignored — der hermes-Eintrag (mit absolutem Binary-Pfad) ist nur auf Zeratul aktiv; andere Hosts müssen ihn selbst setzen (Fleet-Deploy-Zettel).
- E2E (Playwright) nicht erweitert — Adapter ist API-seitig live verifizert, PWA-Startformular-Abnahme für hermes steht aus (P12-Abnahmemuster).
