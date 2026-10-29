# Slash-Commands (/clear, /new …) in UACC — Analyse und Integrationswege

**Datum:** 2026-10-29 · **Anlass:** Nutzerauftrag (Session e20ab9c2):
„/commands wie /clear oder /new von OpenCode, Claude usw. integrieren;
für Harnesses ohne so etwas prüfen, ob wir es nachziehen können (z. B.
maki.sh)." Erst Analyse, dann Umsetzung — dieses Dokument ist die
Entscheidungsgrundlage; der Epic-Entwurf folgt auf Freigabe.

## 1. Fragestellung

1. Können Slash-Commands der Harness-CLIs vom Hub aus **ausgeführt**
   werden (nicht als Chat-Text interpretiert)?
2. Wie bringt UACC sie in die PWA — ohne Adapter-Isolation, K5 oder den
   Prompt-Injektions-Schutz (PRD §8.5) zu verletzen?
3. Was ist mit Harnesses ohne eigenes Command-System?

## 2. Ist-Zustand im Repo (Belege)

- **Kein Contract-Feld dafür.** `AdapterCapabilities`
  (`packages/contracts/src/harness/adapter.ts:87-116`) kennt `steer`,
  `skills`, `agents` u. a. — kein `commands`. `SteerInput` (`:128-144`)
  transportiert freien Text; es gibt keinen Command-Kanal.
- **Die PWA intercepted "/" nicht.** Der Composer
  (`apps/pwa/src/features/composer/Composer.tsx`) sendet reinen Text über
  `POST /api/sessions/:id/steer` bzw. `POST /api/sessions`; der P9-Planer
  (`CommandBar.tsx`, ADR-0027) ist Natursprache, kein Slash-Parsing.
- **Adapter geben Text ungewandelt weiter** — als CLI-Argument (claude,
  opencode, cursor, copilot, pi, codex-exec), Flag (aider `--message`,
  hermes `-q`) oder JSON-Feld (codex app-server `turn/start`, ACP
  `session/prompt`). Niemand transformiert "/…". Ausnahmen ohne Belang:
  Skill-Präfix `/${skill}\n\n` (claude, `claude/src/index.ts:160-162`) und
  Anhangs-Notizen (`contracts/src/attachments/attachment.ts:72-84`).
- **Vorarbeiten existieren:** ADR-0005 koppelt Skills an Claudes
  Slash-System; `claude-meta.ts:22` filtert CLI-injizierte
  `<command-name>`-Meta-Turns aus Discovery-Vorschauen — /clear-Nutzung
  ist im Transkript-Bild also längst Realität, nur nicht steuerbar.
- **Aider kann nicht nachsenden:** `steer(prompt) → {ok:false}`
  (`aider/src/index.ts:159-163`, followUp:false) — Commands nur beim
  Start. Clip-Adapter sind read-only.

## 3. Harness-Lage (Web-Recherche 2026-10-29)

„Getrieben?" = kann ein externer Treiber den Command ausführen lassen?

| Harness | Built-ins (Auswahl) | Getrieben? | Custom Commands |
|---|---|---|---|
| **Claude Code** | /clear (/reset,/new), /compact, /model, /rewind … | **Ja** — `-p` wertet `/command` als Prompt aus; Picker-Commands ohne Argument nicht | `.claude/commands/*.md`, `~/.claude/commands/` |
| **Copilot CLI** | /compact, /context, /model, /review … | **Ja, dokumentiert über ACP** — Command-Text als normaler Prompt-Block; Picker-Commands ausgeschlossen | Custom Agents/Skills |
| **aider** | /clear, /reset, /add, /tokens … | **Ja** — `--message` führt In-Chat-/Commands aus (Doku: scripting) | keine Command-Dateien |
| **oh-my-pi (omp)** | pi-Befehle + eigene | **Ja über ACP/RPC** (Internals-Doku: Dispatch in beiden Modi) | `.omp/commands/*.md` + Import von Claude-/Codex-/OpenCode-Dateien |
| **pi** | /new, /compact, /model, /share … | **Teilweise** — RPC-Protokoll (`--mode rpc`) existiert; Command-Dispatch dort **unverifiziert** | `~/.pi/agent/prompts/*.md` → `/<name>` |
| **OpenCode** | /new, /compact, /models, /undo … | **Unklar** — `opencode run`/HTTP-Server senden Prompts; Slash-Expansion nicht dokumentiert | `.opencode/commands/*.md` |
| **Codex CLI** | /clear, /new, /compact, /review, /fork … | **Unklar** — `codex exec` parst Commands laut offizieller Doku nicht (nur inoffizielle Quelle behauptet es) | `~/.codex/prompts/*.md` (deprecated → Skills) |
| **Cursor CLI** | /clear, /model, /summarize … | **Unklar** — Print-Modus dokumentiert keine Commands | `.cursor/commands/*.md` (CLI-Support unbestätigt) |
| **maki (maki.sh)** | /new, /compact, /model, /fork, /yolo … (kein /clear-Built-in) | **Teilweise** — headless (`--print`, stream-json) + ACP-Server vorhanden; ob /commands dort dispatchen **unverifiziert**. Programmatisch intern: `maki.api.run_command` (Lua) | Command-Dateien (Projekt/User, `/project:<name>`) + `maki.api.register_command` |
| **dsh** | /command über Plugin-Registry | **Nein** — „UI-less demos and ACP automation do not provide this command surface" (Doku) | Plugin `ctx.commands.register` |
| **Hermes** | /new, /clear, /history … | Unklar (keine Headless-Doku gefunden) | Skills als dynamische Commands |
| **claude-/cursor-clip** | — | nein (Beobachter) | — |

## 4. Integrationswege

### Weg A — reiner Passthrough (kein Contract-Bruch, sofort)

Der Composer lässt führende "/…"-Eingaben unverändert durch
`session.prompt`/`steer`. Das funktioniert heute schon für Claude Code
(-p), aider (Start), Copilot (ACP-Preset), omp (ACP). **Problem:** Wo die
CLI im getriebenen Modus nicht dispatcht (OpenCode? Codex exec? dsh:
sicher nicht), wird „/clear" als Chat-Text beantwortet — der Nutzer
glaubt, der Kontext sei geleert. Verstößt gegen „Fail loud".

### Weg B — Command-Katalog im Adapter-Contract (empfohlen, braucht ADR)

1. `AdapterCapabilities.commands?: ReadonlyArray<{ name: "/…";
   description: string; scope: "start" | "steer" | "beides" }>` — neu,
   additiv, **ADR-pflichtig** (Architekturregel 1). Adapter deklarieren
   nur, was ihre CLI im getriebenen Modus nachweislich ausführt; wo
   nichts dispatcht, bleibt die Liste leer und die PWA zeigt das offen
   („keine Commands verfügbar" statt stiller Fehlleitung).
2. PWA: beim Tippen von "/" im Composer Autocomplete aus genau diesem
   Katalog (je Adapter der Session); nicht gelistete Slashes senden nur
   nach sichtbarem Hinweis. PWA bleibt auf Adapter-/Hub-APIs beschränkt —
   keine Hub-Internas (ADR-0020) ✓.
3. Verify-first je CLI (rot-grün mit Captures wie bei codex/EPIC-P1):
   opencode `run`, codex `exec`, cursor `-p`, pi `--mode rpc`, maki
   `--print`/ACP — je ein Test mit `/compact`-Äquivalent, das die
   Kontextwirkung belegt, nicht nur das Fehlen eines Fehlers.
4. Sicherheit: Commands sind Nutzereingabe, nie Agent-Output (PRD §8.5
   unberührt); destruktive Commands (/clear, /reset) über den
   bestehenden Bestätigungs-Tap wie P9-Schreiboperationen (ADR-0027).

### Weg C — Nachziehen für Harnesses ohne Commands

- **maki:** Hat selbst ein reiches System (Built-ins, Command-Dateien,
  `register_command`). Für UACC genügt Verifikation des Dispatch im
  ACP-/headless-Pfad (Weg B.3). Falls maki dort nicht dispatcht: ein
  kleines maki-Plugin, das Commands über `maki.api.run_command` aus einer
  definierten Nachricht ausführt, wäre der saubere Hebel — Infrastructure
  beim Harness, nicht im Hub.
- **pi/omp:** prompt-templates/commands-Dateien — gleiche Verifikation.
- **dsh:** bewusst ohne Headless-Oberfläche; nicht emulieren. Hub-seitig
  gibt es für /new-artiges bereits den P9-Planer (`session.prompt`,
  stop/queue) — das ist die richtige Schicht.
- **Emulation von /clear im Hub ablehnen:** Kontext-Leeren ist
  CLI-interner Zustand; ein Hub-Fake würde K7 (Rekonstruierbarkeit) und
  die Ehrlichkeit der Session-Historie beschädigen.

## 5. Empfehlung und nächste Schritte

**Weg B als Epic** (Weg A allein wäre eine stille Falle für alle
„Unklar"-CLIs). Grobe Tasks:

1. **ADR:** `commands` in `AdapterCapabilities` (Contract, additiv) +
   Semantik (scope, Verify-first-Pflicht, Fail-loud-Leerliste).
2. **Verify-first:** Live-/Capture-Tests für opencode, codex exec,
   cursor, pi rpc, maki headless/ACP (⇑ Tabelle „Unklar/Teilweise").
3. **Adapter:** claude, aider (nur scope:start), copilot- und omp-ACP-
   Presets deklarieren ihre Listen; Testkit-Regel, dass `commands` nur
   mit Beleg gesetzt wird.
4. **PWA:** "/"-Autocomplete im Composer + Hinweisfläche für nicht
   gelistete Slashes; E2E-Spec je Adapter-Verhalten.
5. **Doku:** Adapter-Matrix (docs/adapters.md) um Commands-Spalte.

Messlatten-/Epic-Bezug: P9 (jeder Hub-Flow per Text/Sprache — Slash ist
die deterministische Ergänzung zum Natursprach-Planer, ADR-0027), K2
(Command-Auslösung stört laufenden Tail nicht), K5 (Command-Payloads
winzig), K7 (kein State-Fake), PRD §8.5 (Commands nie aus Agent-Output).
Aufwandsschätzung: 1–2 Agenten-Wochen je nach Anzahl der zu
verifizierenden CLIs (T2 dominiert).

**Antwort auf die maki-Frage:** Ja, maki.sh hat /commands (Built-ins,
Command-Dateien `/project:<name>`/`/user:<name>`, Lua
`register_command`/`run_command`). Ob UACC sie über den ACP-/headless-
Pfad auslösen kann, ist der zentrale offene Verifikationspunkt — nicht
die Existenz, sondern der Dispatch von außen.

## Nachtrag 2026-10-29 — maki live geprüft: nativ ja, getrieben nein, Brücke bewiesen

**Auftrag:** „Hat maki /commands nativ, und welche Built-ins? Sonst Konzept
und Umsetzung eigener Commands." („naki" ist kein bekanntes Harness —
gemeint und geprüft ist maki, maki.sh, lokal installiert als 0.6.5.)

### 1. Nativ: ja (Belege)

- **Built-ins (25):** /compact, /new, /fork, /help, /usage, /queue, /model,
  /theme, /mcp, /login, /cd, /btw, /yolo, /fast, /workflow, /exit, /reload,
  /trust, /packupdate, /packdel, /memory, /rename, /sessions, /tasks,
  /thinking — Quelle: maki.sh/docs/commands/ (vollständige Tabelle); das
  installierte Binary (`strings`, 0.6.5, nicht gestrippt) enthält dieselbe
  Registry samt Beschreibungen und „can only be run by you"-Marker für
  /yolo, /trust, /packupdate, /packdel.
- **Custom Commands:** Markdown-Dateien; Fundstellen `~/.config/maki/commands/`
  (+ legacy `~/.maki/commands/`), `~/.claude/commands/`, Projekt-Walk
  `.maki/commands/` + `.claude/commands/` (cwd→git-root, Projekt schlägt
  User); Palette `/project:<name>`/`/user:<name>`; Frontmatter, `$ARGUMENTS`;
  `--no-commands` überspringt alles (maki --help). **/clear ist kein
  Built-in** — die Doku zeigt es nur als Alias-Beispiel auf /new.
- **Lua:** `maki.api.register_command` / `run_command` (Grant-geprüft,
  Matrix in docs/commands/#plugin-access: /compact + Custom-Commands
  brauchen `agent`+`session_write`, /new+/fork `session_write`).

### 2. Getrieben (UACC-Pfad): nein — live bewiesen

Methodik: HOME-/XDG-Sandbox, eigener OpenAI-protokoll-Provider auf
127.0.0.1-Stub (providers.toml erlaubt http auf Loopback), Custom-Command
`/user:probe-hello` in der Sandbox. Der Stub loggt jede Anfrage mit dem
User-Content — damit ist trennscharf sichtbar, ob ein "/…"-Prompt als
Command **ausgeführt** (keine/wandlungsfreie Anfrage) oder als **Chat-Text**
an das Modell geht. Ohne echte Keys, ohne Kosten.

| Pfad | Prompt | Stub sah | Befund |
|---|---|---|---|
| `maki -p` | `/definitely-not-a-command` | `user="/definitely-not-a-command"` | Chat |
| `maki -p` | `/new` | `user="/new"` | Chat |
| `maki -p` | `/user:probe-hello welt` | `user="/user:probe-hello welt"` | Chat — Custom-Dateien werden getrieben ebenfalls **nicht** expandiert |
| `maki acp` (UACC-Preset) | `/user:probe-hello from-acp` | `user="/user:probe-hello from-acp"` | Chat |
| `maki acp` | `/definitely-not-a-command` | `user="/definitely-not-a-command"` | Chat |

Der Provider-Gate läuft vor jeder Prompt-Behandlung; Slash-Text im
getriebenen Prompt ist maki 0.6.5 schlicht eine Chat-Nachricht.

### 3. Brücke: `agent.user_message`-Slot — Konzept UND Beweis

maki-Hooks (maki.sh/docs/hooks/) bieten `agent.user_message`: feuert,
bevor das Modell die Nachricht sieht, mit `source: "tui"|"acp"|"headless"|"plugin"`;
Rückgabe `nil, reason` verwirft die Nachricht (Modell sieht sie nie),
`run_command` führt jeden Slash-Command grant-geprüft aus. Rezept (init.lua,
Grants in plugin.toml: alles — der Slot verlangt jede Permission):

```lua
local DRIVEN = { acp = true, headless = true }
maki.api.set_slot("agent.user_message", function(prev, msg, ctx)
  if DRIVEN[msg.source] and msg.text:sub(1, 1) == "/" then
    local cmdline = msg.text:match("^%s*(/%S+.-)%s*$")
    if cmdline then
      local ok, err = maki.api.run_command(cmdline)
      return nil, ok and ("Command " .. cmdline .. " ausgeführt (UACC-Brücke)")
                or ("Command " .. cmdline .. " nicht ausführbar: " .. tostring(err))
    end
  end
  return prev(msg, ctx)
end)
```

**Beweis (Sandbox, Stub-Log + ACP-Ergebnis):** ACP `"/new"` →
`stopReason:"refusal"`, **keine** Anfrage an den Stub (Command lief lokal,
Modell unberührt); ACP `"hallo brücke"` → `end_turn`, Anfrage mit dem
unveränderten Text (Kontrolle); unbekannter Command → refusal ohne Anfrage.

Grenzen, ehrlich: Der Drop-Reason erscheint im ACP-Stream nicht als
Agent-Nachricht — der Zug endet mit `refusal`; die Wirkung (z. B. neue
Session) ist der Beleg. Die Brücke ist **Nutzer-Config je Rechner**
(~/.config/maki), kein Repo-Code; Injection-grenze bleibt gewahrt, weil der
Slot nur auf User-Nachrichten mit Source acp/headless reagiert —
Agent-Output läuft nie durch `agent.user_message`.

### 4. Konsequenzen fürs Repo

- ACP-Preset **maki deklariert weiter nichts** (fail-loud war richtig, jetzt
  live belegt statt „unklar").
- Wer die Brücke installiert hat, kann Commands nutzen; eine spätere
  Deklaration im Preset (konfigurierbar) ist Folgeaufgabe, erst nach
  Installation beim Nutzer ehrlich.

### Nachtrag 2 (2026-10-29, abends): Loader-Regel für Brücken-Layer

Beim Feinschliff der Brücke live gefunden: maki **überspringt Layer mit
mehr als einer `prev`-Aufrufstelle still** (deterministisch im A/B
nachgewiesen: identischer Code, nur der Fehlerzweig `return prev(...)`
statt `return nil, …` → Layer feuert nie, "/new" geht als Chat durch).
Konsequenz für jede Brücke dieser Form: **genau ein** `prev`-Aufruf am
Ende; Fehler- und Erfolgsfall droppen. Auch: `io.*` ist in der
Plugin-Sandbox nicht verfügbar (Debug-Ausgaben dort laufen ins Leere,
der Layer wird übersprungen). Beides ist Upstream-wissenswert — siehe
Contributor-Idee in §5.
