---
id: BUG-0189
slug: slash-commands-nicht-bei-allen-anbietern
status: done
severity: S3
area: adapters
instance: dev
commit: "f5fbed08"
forge: ""
created: 2026-11-17
reporter: "Jan (PWA, Nutzerauftrag 17.11.2026)"
epic: "EPIC-P25 (T25.6 Folge)"
---

# BUG-0189 — Slash-Commands fehlen bei den meisten Anbietern („/commands funktionieren nicht in allen Providern")

## Gesehen

Nutzer möchte Harness-Commands im PWA-Chat nutzen (z. B. frischen Kontext
starten) — bei codex, opencode, cursor, pi, deepseek, securesight-harnez
zeigt der Composer „Dieser Adapter meldet keine /Commands — der Text geht
als normaler Prompt"; ein getipptes `/new` geht als normaler Chat-Text ans
Modell. Nutzer-Zitat: „Das ist sehr lästig … Wir müssen diese alle je
Provider/Harness korrekt nutzen können."

## Erwartet

ADR-0042: Pro Harness sind die Commands deklariert, die die CLI **im
getriebenen Modus nachweislich** ausführt — mit Beleg (Doku oder live
verifiziert), nie geraten. Der Composer bietet genau diese an.

## Repro

Live-Probe 17.11.2026, `opencode acp` (2.1.4) direkt per JSON-RPC getrieben
(wie es der Adapter tut; Skript-Transkript unten):

1. `initialize` → Ergebnis enthält **keine** statischen Commands.
2. Erster `session/prompt` → opencode sendet
   `session/update available_commands_update` mit **/init, /review,
   /compact**.
3. Prompt `/new` → **kein Dispatch**: voller Modellturn, das Modell
   antwortet auf den Text („… it's being sent to me as a plain message").
   `/new` ist opencodes eigener Client-Command, kein Agent-Command.
4. Prompt `/compact` → **Dispatch**: `session_info_update` mit
   `_meta.opencode/compaction {status:"started"→"completed", reason:
   "manual"}`, kein Modellturn über das Wort.

Der AncientVoid-ACP-Adapter verwirft `available_commands_update` still
(`packages/adapters/acp/src/normalize.ts`, Zweig → `[]`) und
`ACP_PRESET_COMMANDS` hatte keinen opencode-Eintrag (Kommentar: „no
driven-mode evidence yet") — deshalb deklariert der Adapter nichts und die
PWA meldet „keine /Commands", obwohl der Dispatch-Mechanismus
funktionsfähig ist.

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | lokal (`127.0.0.1:7373`) |
| Commit | `f5fbed08` |
| opencode | 2.1.4 (ACP) |
| Repro-Weg | Direktes Treiben von `opencode acp` (JSON-RPC/stdio) |

## Logs

```text
$ opencode acp — initialize → result.agentCapabilities: loadSession, mcp, prompt … (keine availableCommands)
$ session/prompt "/new"      → agent_thought_chunk: "The user typed `/new` … it's being sent to me as a plain message"
                              → agent_message_chunk: "Starting fresh! …"  (Modellturn, kein Command)
$ session/update available_commands_update → [{init},{review},{compact}]
$ session/prompt "/compact"  → session_info_update _meta.opencode/compaction {"status":"started","reason":"manual"}
                              → session_info_update _meta.opencode/compaction {"status":"completed","reason":"manual"}
                              (kein agent_message/thought — Command lief als Command)
```

## Tests

| Ring | Befehl / Datei | Stand vor dem Fix |
|---|---|---|
| Unit | `packages/adapters/acp/test/commands.test.ts` — preset opencode deklariert genau /init,/review,/compact (wohlgeformt, `/new` nie, custom-command ohne Preset weiter nichts) | rot: Test erwartete (alt) „opencode: nichts" |

## Eingrenzung

Kein Defekt im Zustellweg: Composer → Hub → Adapter → Prompt-Text funktioniert
(vgl. claude /clear, BUG-0079-Nacharbeiten). Die Lücke war die fehlende
Beleg-Sammlung: `packages/adapters/acp/src/index.ts` `ACP_PRESET_COMMANDS`
ohne opencode-Eintrag. ACP-Spec (agentclientprotocol.com/protocol/v1/
slash-commands): „Commands are run as part of regular prompt requests where
the Client includes the command text in the prompt" — deckt sich mit dem
Live-Befund.

## Fix

`ACP_PRESET_COMMANDS.opencode = [/init, /review, /compact]` (scope both)
mit Beleg-Kommentar; Test und `docs/adapters.md`-Evidenztabelle
mitgezogen; dsh bleibt bewusst undeklariert.

## Bewusst offen (kein Fix hier)

- **codex, cursor, pi, hermes**: kein Beleg, dass Slash-Text im getriebenen
  Modus dispatched wird (`codex exec --help`, `cursor-agent --help`,
  `pi --help` schweigen dazu; keine Doku gefunden) — ehrlich leer, die PWA
  meldet es sichtbar. Beleg nachliefern, wenn eine Quelle existiert
  (T25.6 bleibt dafür offen).
- **acp dsh**: Verifikation offen (Standalone-Probe scheiterte am fehlenden
  DeepSeek-Key).
- **`available_commands_update`** wird weiter ignoriert: Dynamisches
  Oberflächen der Agent-Liste (statt statischer Deklaration) wäre die
  generische Lösung — Contract-Frage (wohin mit dynamischen Commands),
  Follow-up, nicht dieser Fix.
- **„/new = neue Session"** bleibt Harness-abhängig: claude hat /clear
  (deklariert), opencode Agent-seitig nicht (Client-Command) — neue Session
  läuft dort über den Neu-Session-Fluss der PWA.

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [ ] GitHub-Issue angelegt (`gh issue create`, URL in `forge:`)
- [x] Fix + Test im selben PR
