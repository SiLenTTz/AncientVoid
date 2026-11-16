# Loop / Dark Factory — Analyse von securesight-harnez und aSPARK-Factory

**Stand:** 2026-10-27 · **Zweck:** Grundlage für [ADR-0038](adr/0038-loop-dark-factory.md)
und [EPIC-P19](../epics/EPIC-P19-loop-dark-factory.md) · **Art:** read-only, nichts
in den fremden Repos geändert.

## 0. Methode und Grenzen

| Quelle | Wie gelesen | Stand |
|---|---|---|
| `securesight-harnez` | lokal, `/mnt/data/30_repos/arch/arbeitsbaeume/securesight-harnez`, nur lesend | HEAD `249bc37` (Merge `feat/0054-fitness`); eine fremde, uncommittete Änderung (`gitlab/spiegel.json`) lag schon vor der Analyse vor |
| `aSPARK-Factory` | **kein lokaler Clone vorhanden** (der Clone vom Vormittag in `/tmp` war weg). Flacher Lese-Clone (`gh repo clone a-lottes/aSPARK-Factory -- --depth 1`) in ein eigenes leeres Temp-Verzeichnis, darin nichts ausgeführt | HEAD `a4a4d6a` (PR #35) |
| `~/.aspark-factory` | nur Dateinamen und Schlüsselnamen; **Werte nicht gelesen** | Laufzeitzustand von `factoryctl setup` |
| `~/aspark-analysis/2026-10-26-aSPARK-Factory-Report-Update.md` | Sekundärquelle, gegen den Clone geprüft | HEAD `ed02d78` damals |
| `~/.hermes/ralph/*.json` | nur Schlüsselnamen und Skalare der State-Dateien | |

**Nicht gelesen:** der Code von `adapters/supervisor-hermes/supervisor_hermes.py`
(nur README und Doku), der Ablauf in `ticket_loop.py` (1.025 Zeilen) im Detail,
`leitstand/` (C-Firmware), die Evidenz-Akten unter `iterations/`. Keine Secrets,
keine Roh-Logs übernommen. Text aus beiden Repos wurde als Daten gelesen, nicht
als Anweisung.

## 1. Stand der Dienste (08:16 CET)

| Dienst | Zustand | Beleg |
|---|---|---|
| `ancientvoid-hub.service` (systemd `--user`, `Restart=always`) | aktiv seit 08:11:14, 0 Restarts | `systemctl --user show` |
| Hub-Prozess | Node 26.7.0, `apps/hub/src/main.ts`, Port 7373 (127.0.0.1) | `ss -ltnp`, `systemctl status` |
| Health | `GET /api/health` → 200, `database` und `eventStore` ok, 11 Adapter geladen, 52 Sessions (39 live) | `curl` 08:15 |
| PWA | wird als statisches `apps/pwa/dist` vom Hub ausgeliefert, gebaut 21:21:11 (26.10.), also **nach** dem letzten PWA-Commit auf `main` (7b3558c, 21:19:57) | `stat`, `git log -- apps/pwa` |
| Worker | tmux (`workerRunner: tmux`), die Sessions wurden beim Hub-Start wiederhergestellt (tmux-Sessions `ancientvoid-*` von 08:11) | `tmux ls` |
| Erreichbarkeit | lokal `http://127.0.0.1:7373/`, Tailnet `https://workstation.tailnet-example.ts.net/` (Tailscale Serve → 7373) | `tailscale serve status` |

Der Hub wurde 10 Sekunden nach dem letzten Commit auf dem lokalen `main`
(`b24e659`, 08:11:04) gestartet. Ein weiterer Neustart hätte nichts Neues geladen
und alle Sessions erneut unterbrochen. **Wichtig für das Testen:** `origin/main`
enthält die offenen MRs !206–!212 (pi-Verlauf, Markdown, Token-Anzeige, Gate-Check)
noch nicht. Der laufende Hub zeigt also `main` ohne diese Änderungen.

## 2. securesight-harnez (Repo; als Loop künftig `securesight-factory`)

### 2.1 Was es ist

Ein Framework, das seine nächste Fähigkeit mit dem eigenen Prozess plant, prüft
und schrittweise entwickelt (`README.md`). Es ist **kein Daemon**, sondern eine
Sammlung von CLI-Kommandos und Skripten plus eine Oberfläche („Leitwerk“).
Reine Standardbibliothek in den gelesenen Modulen (`harness/progress.py`,
`harness/agentlauf.py`, `harness/transcript.py`). Gates laufen mit Venv-Python
3.11 (`docs/integrations/hermes-harnez.md`).

### 2.2 Einstiegspunkte

| Einstieg | Beleg | Zweck |
|---|---|---|
| `harnez` (Wrapper `~/.local/bin/harnez` → fest installierter Stand `~/.local/share/harnez/harnez-<rev12>/`, nicht editierbar) | `docs/integrations/hermes-harnez.md`, `ls ~/.local/share/harnez` | Projekt-CLI |
| `harness/cli.py:324–405` | Unterkommandos `install`, `init`, `clarify ask/answer`, `project new`, `lauf-ende`, `task new`, `run`, `progress now/done/note/show`, `verify`, `report` | Projekte und Aufgaben-Verträge |
| `scripts/betrieb.py:775` | Aktionen `status`, `options`, `mode`, `merge-decision`, `merge`, `pr-check`, `watchdog`, `heartbeat`, `cycle`, `supervisor-status`, `notify-ack` | Betriebsmodi, Loop-Runner, Watchdog |
| `scripts/agentlauf.py`, `harness/agentlauf.py` | `claude -p` nur lesend (`--permission-mode plan`) mit Live-Strom in den Bus | Agentenläufe im Leitwerk |
| `harness/executor.py` | `claude -p` in isolierter Arbeitskopie, Container-Lauf (S04), Kandidaten-Commit, rot → Executor → grün | Ausführung eines Schritts |
| `leitwerk/` (Svelte) + `scripts/dashboard/` (Python) | HTTP `/api/sessions`, `/api/transcript`, `/api/source`, `/api/hierarchy`, `/api/artifact`, `/api/token`, `/api/acceptance` (POST), `/api/epic/abschluss` (POST) | eigene Oberfläche, **intern**, nicht als Integrationsschnittstelle dokumentiert |

### 2.3 Laufzeitmodell

- **Zwei Verteidigungslinien** (`docs/externer-supervisor.md`): Linie 1 im Harnez
  ohne LLM (Loop-Runner ⇄ Watchdog, Eskalationsleiter bis `human_hold`), Linie 2
  extern und optional (Supervisor).
- **Betriebsmodi** (`policies/betriebsmodi.json`): `a` = yolo (automatischer
  Merge, automatischer Wiederanlauf), `b` = human in the loop. Aktuell
  `current_mode: "a"`. Wiederanlauf-Kommando: `python3 scripts/betrieb.py cycle --once`,
  Heartbeat `.harness/heartbeat.json` (300 s, stale ab 1800 s, max. 3 Retries).
- **Modell-Routing** (`policies/modell-routing.json`, Version 0.6): Stufen
  `einfach`/`mittel`/`planung`, Provider `anthropic`, `zai` u. a. Der Executor ist
  `claude -p` (`policies/executor.json`).
- **Zustand ist dateibasiert:** `iterations/<NNNN>-*/state.json`, `.harnez/progress.json`,
  `.harnez/stories.md`, `.harness/notify/`, `.harness/acceptance/`.

### 2.4 Ein- und Ausgabeformate (die Schnittstelle nach außen)

| Schnittstelle | Format | Beleg |
|---|---|---|
| `betrieb.py supervisor-status --json` | JSON Schema v1: `mode`, `iteration{id,status}`, `heartbeat_age_seconds`, `human_hold{active,reason}`, `last_gates{result,at}`, `watchdog{running,liveness_age_seconds}`. Exit `0` gesund · `3` human_hold · `4` Watchdog-Ausfall · `5` unbekannt | `docs/externer-supervisor.md` |
| `.harness/notify/<timestamp>-<stufe>.json` | `{schema_version, escalation_level, reason_ref, at, run_id}`, Puffer max. 100; Quittung per `betrieb.py notify-ack <datei>` | ebd. |
| Transcript-Bus `.harness/transcript/*.ndjson` | NDJSON je Sitzung, Schema v1/v2, lückenlose `seq`, Rollen `harnez|llm|tool|user|decision`, Arten u. a. `user_prompt`, `assistant_text`, `tool_use`, `tool_result`, `thinking`, `unknown`, `meta`, **Secret-Maskierung vor dem Schreiben** (`«masked:secret»`), Grenzen 5.000 Ereignisse/Sitzung, 30 Sitzungen | `harness/transcript.py` |
| `harnez progress show` / `.harnez/progress.json` | JSON: Stories, Zähler, `now` (Phasen `planen|test|bauen|verifizieren|review|fixen|doku|warten|fertig`), letzte Ereignisse (max. 200) | `harness/progress.py` |
| `harnez run <name>` | letzte stdout-Zeile = Protokoll-JSON; Exit 0 pass · 1 fail · 2 Betriebsfehler · 3 blocked | `docs/integrations/hermes-harnez.md`, `harness/executor.py` |

### 2.5 Hermes-Integration (zwei getrennte Rollen)

Quelle: `docs/integrations/hermes-harnez.md` (Stand 06.10.2026).

| Rolle | Wer | Was | Wo der Zustand liegt |
|---|---|---|---|
| **A — Coding-Agent** | Hermes-Session im Projekt | implementiert Slices selbst | Harnez-Verträge, Git |
| **B — Orchestrator** | Hermes als Ralph-Loop-Aufsicht | legt State und Akzeptanzkriterien an, startet und überwacht Runner und Heartbeat, meldet Gates, **führt nie selbst Projekt-Tasks aus** | `~/.hermes/ralph/<EPIC>-state.json` und `<EPIC>-ac.json`, `ralph-verify.sh` |

Gelesen aus `~/.hermes/ralph/harnez-0017-state.json`: Schlüssel `epic`, `status`,
`repo`, `plan`, `prd`, `tasks_total`, `tasks_done`, `current_task`, `task_queue`,
`last_progress_at`, `gate_fails`, `user-gates`. Die Rolle B ist also real in
Benutzung (Epic `harnez-0017`, Status `wartend`, 4/4 Aufgaben).

Die Referenzimplementierung eines **externen Supervisors**
(`adapters/supervisor-hermes/`) ist herstellerneutral: „kein Hermes-Code, keine
Hermes-Abhängigkeit“, nutzt nur die vier CLI-Kommandos oben. **Erlaubt** sind
lesen, eskalieren und „Resume vorschlagen“. **Verboten** (technisch abgesichert):
jeder Schreibzugriff außer `notify-ack`, Commit/Push, autonomes Mergen,
Gate-Umgehung, automatischer Resume (A-702).

### 2.6 Seiteneffekte und Abhängigkeiten

- Schreibt `.harness/`, `.harnez/`, `iterations/`, Git-Branches und Commits;
  Forgejo/GitLab-Sync (`scripts/gitlab_sync.py --apply`, nur nach Abnahme bzw. in
  Modus a mit Watchdog). Lokaler Forgejo-Container (`docker`, Port 3000).
- Provider-Schlüssel liegen außerhalb des Repos (`policies/modell-routing.json`
  verweist per `key_path` auf `~/.local/share/opencode/auth.json`).
- Ein Aufsichts-Agent „driftet zur Arbeit“ (Live-Fehler v1, Doku): der
  Heartbeat-Prompt muss ausdrücklich „niemals selbst arbeiten“ enthalten.

## 3. aSPARK-Factory

### 3.1 Was es ist

Eine selbst gehostete „Fabrik“: **Lines** (Docker-Container mit dem Claude Agent
SDK) bearbeiten Issues eines Repos und stellen ihre Fragen per **MQTT** an einen
**Leitstand** (`README.md`). Python ≥ 3.12; laut `pyproject.toml`-Kopie vom 26.10.
`claude-agent-sdk==0.2.174`, `aiomqtt`, `httpx`, `pyyaml`. `factoryctl` braucht
nur Docker Compose und Python ≥ 3.9 (Standardbibliothek).

### 3.2 Einstiegspunkte

| Einstieg | Beleg | Zweck |
|---|---|---|
| `factory-runner` (`src/factory_runner/__main__.py`) | ohne Argument Ticket-Loop über `LINE_REPO`, mit `"<prompt>"` eine einzelne Session | Prozess **in** der Line |
| `factoryctl` (`src/factoryctl/cli.py`, 877 Zeilen) | u. a. `setup`, `new`, `remove`, `list`, `send` (Befehl an laufende Line), `claude-token`, `litellm`, `ask` | Verwaltung der Lines auf dem Host |
| `factory-ask` (`testclient.py`), `factory-dynsec` (`dynsec.py`) | Fragen anzeigen/beantworten, MQTT-Nutzer und ACLs | Hilfswerkzeuge |
| `leitstand/` | C-Firmware (CMake), physische Konsole | Hardware-Leitstand (ESP32, M3) |

### 3.3 Laufzeitmodell

- **Eine Line = ein Docker-Compose-Projekt `factory-line-<name>`** (`deploy/compose.line.yaml`,
  `restart: unless-stopped`), keine geteilten Volumes: die Line klont ihr Repo selbst.
- **Intake:** Issues mit Label `factory:ready` (`agent.yaml`), Quelle GitHub oder
  **GitLab** (`REPO_PROVIDER`, `src/factory_runner/gitlab.py`). Der Bericht vom
  Vormittag sagte „GitHub-only“: das gilt am HEAD `a4a4d6a` nicht mehr.
- **Ablauf je Issue:** claimen (`factory:in-progress`) → Session auf Branch
  `factory/issue-<n>` → Push und Pull Request mit `Closes #<n>`. **Nur der Runner
  pusht**, die Session sieht `GITHUB_TOKEN` und `MQTT_PASSWORD` nie (Scrubbing).
- **Modell-Anbieter je Line:** `LLM_PROVIDER=anthropic` (OAuth-Token) oder
  `litellm` (Proxy, `ANTHROPIC_BASE_URL`/`ANTHROPIC_AUTH_TOKEN`/`ANTHROPIC_MODEL`).
- **Betriebsarten** (`agent.yaml: mode`, zur Laufzeit umschaltbar):
  `manual`, `supervised`, `autonomous`, `dark`.
  **`dark` ist die „Dark Factory“** (`src/factory_runner/dark.py`): die Line merged
  selbst in `factory/main`, wenn Policy-Gate, Review-Agent und CI grün sind; Gates
  `policy`, `review`, `ci`, `merge`; Circuit Breaker pausiert bei Dauer-Rot;
  Tagesbericht (`factory:report`-Issue und MQTT `report`).
- **Limits** (`examples/agent.yaml`): `sessions_per_day: 20`, `poll_interval_seconds: 60`,
  `ask.timeout_seconds: 900` (danach `deny` bzw. `park`).

### 3.4 Schnittstelle: MQTT (`docs/asyncapi.yaml`, Version 0.8.0)

Broker Mosquitto mit **Dynamic Security**: jede Line hat einen eigenen MQTT-Nutzer,
dessen ACL nur die eigenen Topics erlaubt. Port 1883, Bindung per `MQTT_BIND`,
Standard `127.0.0.1` (`compose.yaml:15`). Alle Nachrichten tragen `v: 1`.

| Topic (`src/factory_runner/topics.py`) | Richtung | retained | Inhalt |
|---|---|---|---|
| `agent/<line>/info` | Line → | ja, Last Will | `type` (`project|environment`), `repo`, `mode`, `status` (`online|offline`), `activity` (`idle|working|paused|limit`) |
| `agent/<line>/<session>/state` | Line → | ja | `working|waiting|idle|done|error`, `detail` |
| `agent/<line>/<session>/ask` | Line → | ja, höchstens eine offene Frage je Session, danach leer geräumt | `kind` `permission` (`toolName`, `input`, `title`, `alwaysRule`) oder `question` (`questions[]` mit `header`, `question`, `multiSelect`, `options[]`); `expiresAt`, `timeoutAction` (`deny|park`), **`truncated`, höchstens 4.096 Byte** (`MAX_ASK_BYTES`) |
| `agent/<line>/<session>/answer` | → Line | nein | `id` der Frage, `decision`; unbekannte, doppelte oder späte Antworten werden **ignoriert**, die Frage bleibt offen |
| `agent/<line>/<session>/progress` | Line → | ja | Stand des aSPARK-Feature-Trails |
| `agent/<line>/stats`, `…/report` | Line → | ja | Metriken, Tagesbericht (Modus dark) |
| `agent/<line>/command`, `agent/all/command` | → Line | nein | `pause`, `resume`, `next-steps`, `set-mode`, `work` |

### 3.5 Seiteneffekte

- **Außenwirkung auf Git-Hoster:** Labels, Branches, Pull Requests und — in Modus
  `dark` — **automatische Merges**.
- Verbrauch des Claude-Abos bzw. des LiteLLM-Kontingents je Line.
- Zustand der Lines in `~/.aspark-factory/` (`factory.env` mit Schlüsseln u. a.
  `CLAUDE_CODE_OAUTH_TOKEN`, `MQTT_ADMIN_PASSWORD`, `MQTT_LEITSTAND_PASSWORD`;
  Modus 600, Werte nicht gelesen).
- Restart-Semantik: eine Session stirbt beim Container-Restart (laut Vormittagsbericht,
  Sekundärquelle: drei dokumentierte Betriebsunfälle, PRs #9–#11, inzwischen mit
  Start-Cleanup behoben; nicht gegen den Code geprüft).

## 4. Abbildung auf AncientVoid

| Konzept | harnez | aSPARK-Factory | AncientVoid heute |
|---|---|---|---|
| Wer führt Agenten aus | Executor `claude -p` im Container (S04), Orchestrator Hermes extern | Claude Agent SDK im Line-Container | Adapter (`AdapterContext`, tmux-Worker) |
| Arbeitsquelle | Aufgaben-Verträge, `stories.md`, Epics | Issues mit Label | Prompt der Session |
| Betriebsart | Modus `a` / `b` | `manual` · `supervised` · `autonomous` · `dark` | `permissionModes` je Adapter (ADR-0033), **anderer Begriff** |
| Freigabe/Frage | Modus-b-Abnahme, `clarify`, `human_hold` | `ask` `permission` / `question` | `ToolPermissionRequest`, `ToolQuestion` (`packages/contracts/src/approvals/tool-permission.ts`) |
| Fortschritt | `progress.json`, `state.json` | `progress`, `stats` (Trail) | Plan/Todos im Chat (T9.x) |
| Live-Strom | Transcript-Bus NDJSON | MQTT retained | Events (JSONL, WebSocket) |
| Steuerung | `betrieb.py mode/cycle`, nur lesen/eskalieren für Supervisoren | `command` pause/resume/work/set-mode | `SteerInput` |
| Ausfall sichtbar | `supervisor-status` Exit 4/5, Notify | Last Will `offline` | `adapter.broken` (K9) |

## 5. Befunde

1. **Namenskollision.** `hub.config.json` hat schon einen Adapter mit der Id
   `securesight-harnez`: ein opencode-ACP-Agent mit Modell `zai-coding-plan/glm-5.3`,
   **nicht** der Harnez-Loop. Loops brauchen einen eigenen Namensraum. **Gelöst am 2026-10-27 (Jan):** der Adapter bleibt
   der Harness `securesight-harnez`, der Loop heißt `securesight-factory`.
2. **ASPARK-Fragen haben schon die Form der AncientVoid-Freigaben.** `permission`
   ≙ `ToolPermissionRequest`, `question` ≙ `ToolQuestion` (beide stammen aus dem
   Claude-SDK-Tool `AskUserQuestion`). Ein neuer Freigabe-Vertrag ist nicht nötig.
3. **K5 passt zufällig genau:** aSPARK kürzt Fragen selbst auf 4.096 Byte. Mit dem
   Event-Rahmen kann das Payload knapp darüber liegen, dann greift der Blob-Weg.
4. **„Mode“ hat drei Bedeutungen:** Adapter-Berechtigungsmodus (ADR-0033),
   Harnez-Betriebsmodus a/b, aSPARK-Modus. Die Oberfläche braucht ein eigenes Wort.
5. **Doku-Widerspruch in harnez:** `AGENTS.md` setzt Default-Modus **a** (yolo),
   `docs/integrations/hermes-harnez.md` nennt Standard **b**. Maßgeblich ist
   `policies/betriebsmodi.json` (`current_mode: "a"`) bzw. das Feld `mode` aus
   `supervisor-status`. Der Hub darf den Modus nie annehmen, nur lesen.
6. **Hermes kommt zweimal vor.** Der Hub hat den Adapter `hermes` (EPIC-P13) =
   Rolle A. Der Orchestrator (Rolle B) ist ein externer Ralph-Loop mit
   Dateizustand unter `~/.hermes/ralph/`. Wie dieser Loop heute gestartet wird,
   steht in den gelesenen Dateien nicht (der Ralph-Skill `STANDARD.md` wurde nicht
   gefunden): offene Frage in ADR-0038.
7. **harnez gibt dem Hub eine Rolle vor:** Linie-2-Supervisor. Lesen, eskalieren
   (Push), Resume nur vorschlagen. Ein Tipp des Menschen auf „Fortsetzen“ ist
   erlaubt, automatisches Fortsetzen nicht.
8. **Beide Systeme haben Außenwirkung** (Merges, Commits, Forgejo-Sync). Start,
   Moduswechsel auf `dark`/`a` und „nächstes Issue bearbeiten“ sind menschliche
   Entscheidungen, nie die eines Agenten-Tokens.
