---
id: BUG-0079
slug: maki-slash-bridge-fuehrt-commands-nicht-aus
status: done
severity: S2
area: adapters
instance: dev
commit: "843a238"
forge: "https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/33"
epic: "EPIC-P25"
created: 2026-10-30
reporter: "Jan (Session 3cc3df35, PWA)"
---

# BUG-0079 — maki-Slash-Brücke führt deklarierte Commands nicht aus („/new" kam nur als Chat an)

## Gesehen

Nutzer schickt `/new` im PWA-Chat einer maki-Session (ACP, `bridgeCommands: true`).
Der Command wird **nicht** über die init.lua-Brücke (`maki.api.run_command`)
ausgeführt, sondern erreicht das Modell als ganz normale Textnachricht — das
Modell antwortet darauf als Chat. Nutzer-Zitat: „es sieht so aus als würde es
lediglich als Nachricht geschickt werden".

Beleg (EventStore, Session `3cc3df35…/events.jsonl`):

```text
seq 2169  2026-10-30T13:44:05Z  user   text: "/new "          ← Prompt sauber beim Adapter
seq 2170+ 2026-10-30T13:44ffZ   thinking/assistant …          ← voller Modellturn lief
```

Kein `stopReason: "refusal"`, kein `acp.command_executed` (System-Event aus
`packages/adapters/acp/src/index.ts` refusal-Zweig). Session-gesamt: 2261
Events, 0 Command-Ausführungen.

## Erwartet

`/new`, `/compact`, `/rename` (MAKI_BRIDGE_COMMANDS, ADR-0042) werden im
getriebenen Modus über `maki.api.run_command` ausgeführt; der Zug endet mit
`refusal` und der Adapter emittiert `acp.command_executed` — das Modell sieht
die Nachricht nie (Kommentar-Zusage in `index.ts:486–491`).

## Repro

**gesehen (PWA + EventStore).** Wiederholbar vermutlich bei jedem Slash in
jeder maki-Session (0 Ausführungen über alle 101 Sessions in `data/sessions/`
— der einzige String-Treffer für `acp.command_executed` stammt aus
Tool-Output-Zitaten, nicht aus echten Events).

1. Hub läuft, maki-Adapter mit `bridgeCommands: true` (hier: `hub.config.json`,
   id `maki`, preset `maki`).
2. PWA → maki-Session → Composer: `/new` senden.
3. Beobachten: Chat zeigt einen normalen Modellturn statt
   „Command /new über die Brücke beendet".

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | lokal (systemd `ancientvoid-hub.service`, Haupt-Checkout) |
| Commit | `843a238` (main) |
| Adapter | `@ancientvoid/adapter-acp`, preset `maki`, `bridgeCommands: true` |
| Brücke | `~/.config/maki/init.lua` installiert (Slot `agent.user_message`, 2026-10-29) |
| Repro-Weg | PWA (Nutzer) + EventStore-Nachweis |

## Logs

EventStore-Auszug siehe „Gesehen". Hub-seitig kein Fehler-Event — das ist
Teil des Symptoms: der Prompt wird still als Chat durchgereicht, nichts
scheitert laut (Fail-loud-Verstoß im Erfolgsversprechen der Doku).

## Tests

| Ring | Befehl / Datei | Stand |
|---|---|---|
| Contract (Stub) | `packages/adapters/acp/test/contract.test.ts` (refusal→`acp.command_executed`) | grün — aber gegen Stub, nicht gegen echtes maki |
| E2E | `e2e/specs/slash-commands.spec.ts` | deckt Autocomplete + unlisted-Hinweis ab, **nicht** die Ausführung über die echte Brücke |

Lücke: kein Test fährt `/new` gegen ein echtes `maki acp`. Ein solcher
Integrationstest (rot) gehört in den bugfix; Markierung „Stub-Beweis" in
`index.ts:490` und T25.6-Rest („Live-Verifikation offen") haben die Lücke
bereits angekündigt.

## Eingrenzung → Root-cause (belegt 2026-10-30, bugfix)

Diagnosesonde (Log-Zeile im Slot-Einstieg von init.lua) klärte die Hypothesen:

- **RC1 — Slot feuert im ACP-Modus nie (H1):** unter `maki -p` loggt die
  Sonde (source=headless), unter `maki acp` (Handshake-Test mit
  session/prompt) bleibt sie still. Die Layer-Mechanik läuft für ACP-Prompts
  nicht — die Brücke sieht getriebene Prompts gar nicht.
- **RC2 — run_command braucht eine UI:** der headless-Lauf lieferte
  `Command /new nicht ausfuehrbar: no interactive UI attached`. Auch ein
  feuender Slot könnte im getriebenen Modus nicht ausfuehren.

Die init.lua-Brücke ist für ACP damit per Design tot (maki 0.6.5). H2/H3
sind damit gegenstandslos.

## Fix (MR !274, main 16cd32f)

- **Adapter-seitige Ausführung** (`runBridgeCommand`,
  `packages/adapters/acp/src/index.ts`): `/new` öffnet über die bestehende
  ACP-Verbindung eine frische Session (`session/new`, live belegt) und
  emittiert `acp.command_executed` — kein Modellturn. Wirkt in steer (beide
  Pfade) und drainQueue.
- **Ehrliche Deklaration (ADR-0042):** `MAKI_BRIDGE_COMMANDS` nur noch
  `/new`; `/compact` und `/rename` haben im getriebenen Modus keinen Beleg
  und sind entfernt (commands.test.ts angepasst).
- Undeklarierte Slashes bleiben Chat — sichtbar, nichts still.
- init.lua unverändert (Sonde entfernt); für ACP irrelevant geworden.

## Verify

- Neu `packages/adapters/acp/test/bridge-commands.test.ts` (3 Tests gegen
  echten Fixture-ACP-Prozess mit RPC-Log): **rot vor dem Fix** (nur der
  /new-Fall), **grün danach**; Contract-Suite weiter grün.
- Volles Gate auf dem Branch: Unit **1127/1127**, Lint, Typecheck,
  check:arch grün; E2E **270/270** (inkl. neuer selection-copy-Spec —
  Nutzer-Anforderung „Markieren → Auto-Zwischenablage" vom selben Tag,
  mitgemerged als `^ F pwa:` auf demselben Branch).

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [x] GitLab-Issue angelegt ([#33](https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/33))
- [x] `bugfix` (MR !274, Root-cause + Verify oben)
