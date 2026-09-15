# ADR-0005 — Skill-/Agent-Invocation-Mechanismus pro Adapter

**Status:** akzeptiert · **Betrifft:** `packages/adapter-claude/src/index.ts`,
`packages/adapter-codex/src/index.ts`, `packages/contracts/src/session.ts`,
T1.5-9/T1.5-10 (`EPIC-P1.5-control-center-ux.md`)

## Kontext

T1.5-9 ist laut EPIC-P1.5 harte Vorbedingung für T1.5-10 (Skill-/Agent-Overlay)
— kein Overlay-Code vorher. Die Frage: wie erreicht „Nutzer hat im Overlay
Skill/Agent X gewählt" tatsächlich den zugrunde liegenden CLI-Prozess? Dieses
ADR untersucht **gegen die echten CLIs** (nicht gegen Doku-Erinnerung — exakt
die T1.2/T1.3-Disziplin, P1-Retro Erkenntnis 1) und dokumentiert das
Ergebnis, statt einen einheitlichen Mechanismus für beide Adapter zu
unterstellen.

## Untersuchung (real durchgeführt, Session 012Ga2NDi683xR9E63StoN7T, 2026-09-15)

### claude — zwei echte, verschiedene Mechanismen

1. **Skills → `/skill-name`-Präfix im Prompttext.** `claude --help` sagt es
   selbst, unter der `--bare`-Beschreibung: „Skills still resolve via
   /skill-name" und `--disable-slash-commands`: „Disable all skills" — Skills
   sind an das Slash-Command-System gekoppelt, nicht an einen eigenen Flag.
   **Live verifiziert**, nicht nur aus der Doku übernommen:
   ```bash
   claude -p "/bugfix

   Ignore any actual bug — just reply with one sentence confirming whether
   the bugfix skill's instructions were loaded into your context for this
   turn, and nothing else. Do not read or write any files." \
     --output-format stream-json --verbose --dangerously-skip-permissions
   ```
   Antwort: *„Yes, the bugfix skill's instructions were loaded into my
   context for this turn."* — funktioniert **in `-p` (non-interaktiv)**,
   genau der Modus, den `adapter-claude` benutzt. Das `system/init`-Event
   derselben Antwort listet zusätzlich `"skills":[...]` — die vom CLI
   **selbst aufgelöste** Liste (Projekt-`.claude/skills/` **und**
   `~/.claude/skills/`-Nutzer-Skills **und** Plugin-Skills gemischt, z. B.
   `diagnose-crash`/`omarchy`/`dataviz` stammen nicht aus diesem Repo). Für
   T1.5-10s Scanner heißt das: die reine Verzeichnis-Liste aus
   `<projekt>/.claude/skills/` ist eine **Untermenge** dessen, was `/name`
   im Prompt tatsächlich adressieren kann — für den Overlay bewusst
   trotzdem nur die Projekt-Skills, weil das mit dem Nutzer-Rückfrage-1-
   Entscheid übereinstimmt (Quelle ist das Zielprojekt, nicht eine globale
   Registry) und weil `~/.claude/`-Nutzer-Skills geräteabhängig sind (der
   Hub läuft auf Omarchy, das Handy nicht).
2. **Agents → `--agent <name>`-CLI-Flag.** `claude --help`: „Agent for the
   current session. Overrides the 'agent' setting." **Live verifiziert:**
   ```bash
   claude -p --agent hub-dev "Reply with exactly one sentence confirming
   which agent persona (name) you are currently running as for this
   session. Do not read or write any files." \
     --output-format stream-json --verbose --dangerously-skip-permissions
   ```
   Antwort: *„I'm currently running as the hub-dev agent persona for this
   session."* — `hub-dev` ist ein in diesem Repo definierter Agent
   (`.claude/agents/hub-dev.md`), kein eingebauter. Das `system/init`-Event
   listet `"agents":["claude","epic-planner","Explore","general-purpose",
   "hub-dev","Plan","pwa-dev","statusline-setup"]` — Repo-eigene und
   eingebaute Agents in derselben Liste, ununterscheidbar ohne die
   Verzeichnis-Herkunft separat zu kennen.

**Semantischer Unterschied, nicht nur syntaktischer:** Ein Skill lädt
zusätzliche Instruktionen **für diesen Turn** in einen ansonsten normalen
Lauf — mit einem Agent wechselt die **gesamte Sitzung** die Persona
(System-Prompt, ggf. erlaubte Tools). Beide sind gleichzeitig nutzbar
(`--agent hub-dev` **und** `/bugfix` im selben Aufruf), sie schließen sich
nicht aus.

**Unverifizierte Randfrage (bewusst offen, kein Blocker für T1.5-10):** Ob
`--agent` bei einem **`--resume`**-Aufruf (Folge-Prompt, T1.5-6/steer)
überhaupt noch etwas bewirkt oder von der CLI ignoriert wird, wurde nicht
getestet — die Flag-Beschreibung („for the current session") legt nahe,
dass die Persona beim ersten Start feststeht. Skills über `/name` sind
davon nicht betroffen, da sie reiner Prompttext sind und bei jedem Turn neu
wirken. T1.5-10 muss das vor der Implementierung von „Agent-Wechsel bei
Folge-Prompts" empirisch klären, nicht annehmen.

### codex — kein Gegenstück, belegt

- `codex exec --help`/`codex --help`: kein `--skill`/`--agent`-Flag, keine
  Erwähnung von projekt-lokalen Skills/Agents.
- `codex plugin list` (real ausgeführt): liefert **Marketplace-Plugins**
  (`documents@openai-primary-runtime`, `pdf@...`, `spreadsheets@...`) — ein
  global installiertes Fähigkeiten-System, **unabhängig vom Zielprojekt**,
  strukturell nicht verwandt mit `.claude/skills/`. Es gibt keinen Weg,
  „lies `<projekt>/.claude/skills/bugfix/SKILL.md` für diesen Lauf" an
  codex zu übergeben.
- `-p, --profile <CONFIG_PROFILE_V2>` (`codex exec --help`) legt
  `$CODEX_HOME/<name>.config.toml` über die Basis-Config — das ist
  Modell-/Sandbox-/Feature-Konfiguration, keine Instruktions- oder
  Persona-Injektion, und ebenfalls nicht an ein Zielprojekt gebunden.

**Konsequenz:** codex bekommt in T1.5-10 kein „Senden mit …", sondern den
in der Epic bereits vorgesehenen ehrlichen Zustand „für diesen Adapter
nicht verfügbar" (AC-P1.5-12) — kein Prompttext-Basteln, das vielleicht
nichts bewirkt.

## Entscheidung

### Contract: kein neuer `SteerInput`-Fall, Nutzung von `SessionSpec.args`

`packages/contracts/src/session.ts`s `SessionSpec.args: z.record(z.unknown())`
ist bereits genau als „adapterspezifischer Freiraum, vom Adapter selbst
validiert" beschrieben — dafür gebaut. Kein Contract-Bruch, keine neue
ADR-pflichtige Schema-Änderung nötig; `adapter-claude` definiert und
validiert sein eigenes `args`-Schema selbst (Zod, wie `CodexConfig`/
`ClaudeConfig` es für Adapter-Config bereits tun):

```ts
const ClaudeSessionArgs = z.object({
  skill: z.string().min(1).optional(),
  agent: z.string().min(1).optional(),
}).optional();
```

`adapter-claude/src/index.ts`s `buildArgs()`/`start()`:
- `args.agent` gesetzt → `--agent <agent>` an die initiale Invocation
  anhängen (nur beim ersten Start, siehe offene Randfrage oben — beim
  `steer(prompt)`-Resume **nicht** erneut anhängen, bis empirisch geklärt).
- `args.skill` gesetzt → Prompt wird zu `` `/${skill}\n\n${prompt}` ``
  umgebaut, **nicht** als separates CLI-Argument — exakt der Weg, der live
  verifiziert wurde. Gilt für **jeden** Turn (initial und Resume), da reiner
  Prompttext.
- Beides gleichzeitig gesetzt → beides anwenden (orthogonal, siehe oben).

`adapter-codex`: **kein** entsprechendes `args`-Feld — ein gesetztes
`args.skill`/`args.agent` wird ignoriert und **muss** ein sichtbares
`system`-Event auslösen („codex: skill/agent selection ignored — no
project-local skill/agent mechanism exists for this adapter", Fail loud,
AGENTS.md Regel 6), nicht stillschweigend verschluckt werden. Das ist der
Beleg, den AC-P1.5-12 für „kein heimliches Umschreiben" verlangt.

### UI-seitige Konsequenz (Umsetzung in T1.5-10, hier nur festgelegt)

Das Overlay muss pro Adapter wissen, ob `skill`/`agent` überhaupt greift —
dafür reicht **kein** neues `AdapterCapabilities`-Feld (das wäre für ein
Detail, das nur `claude` betrifft, zu grobkörnig gegenüber der bereits
bestehenden vier Felder); stattdessen liefert der in T1.5-10 gebaute
Scanner-Endpunkt selbst pro Projekt+Adapter, ob eine Auswahl übergeben
werden kann — für codex immer `false`, mit Begründungstext aus diesem ADR.

## Konsequenzen

- Kein Contract-Change an `packages/contracts/`, kein neues ADR-Erfordernis
  für einen Schema-Bruch — `SessionSpec.args` trägt das bereits.
- `adapter-claude` bekommt eine neue, kleine, eigene Zod-Validierung für
  `args` (Muster: `CodexConfig`/`ClaudeConfig` in den jeweiligen
  `index.ts`-Dateien) plus Unit-Tests: `--agent` wird an die Initial-
  Invocation angehängt, `/skill` wird dem Prompt vorangestellt, beides
  kombiniert funktioniert, ein gesetztes `args.agent` bei einem
  `steer(prompt)`-Aufruf löst (bis zur empirischen Klärung der Randfrage)
  bewusst **keine** erneute `--agent`-Übergabe aus — mit Kommentar, warum.
- `adapter-codex` bekommt einen expliziten Fail-loud-Pfad für
  ignorierte `args.skill`/`args.agent`, keinen stillen No-Op.
- T1.5-10s Scanner muss zwischen „Skill" (`/name`-Konvention) und „Agent"
  (`--agent`-Konvention) unterscheiden können, da beide unterschiedlich an
  den Adapter weitergereicht werden — die Overlay-Datenstruktur trägt daher
  `kind: "skill" | "agent" | "workflow"` (Letzteres weiterhin unbefüllt, da
  keine verifizierte Konvention existiert, siehe EPIC-P1.5 §3.5).
- Der reale `system/init`-Fund (CLI löst Nutzer- **und** Projekt-Skills
  gemischt auf) ist eine dokumentierte, bewusste Diskrepanz zum
  Overlay-Scope (nur Projekt-Skills) — kein Bug, aber erwähnenswert, falls
  ein Nutzer sich fragt, warum `/omarchy` im echten CLI funktioniert, aber
  im Overlay nicht auftaucht.
