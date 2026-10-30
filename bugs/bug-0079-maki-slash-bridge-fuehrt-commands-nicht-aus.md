---
id: BUG-0079
slug: maki-slash-bridge-fuehrt-commands-nicht-aus
status: open
severity: S2
area: adapters
instance: dev
commit: "843a238"
forge: "https://gitlab.com/SiLenT_Tz/mobile-hub/-/work_items/33"
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
| Instanz | lokal (systemd `uacc-hub.service`, Haupt-Checkout) |
| Commit | `843a238` (main) |
| Adapter | `@uacc/adapter-acp`, preset `maki`, `bridgeCommands: true` |
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

## Eingrenzung

Fakten: Adapter-Config korrekt (`bridgeCommands: true`), Commands deklariert
(`index.ts:109–113`), Prompt kam sauber mit führendem `/` an (seq 2169),
Brücke installiert (`init.lua` mit `set_slot("agent.user_message", …)`,
`DRIVEN = {acp, headless}`), `prev` genau einmal aufgerufen
(Loader-Regel beachtet). Trotzdem: Modellturn gelaufen, Nachricht nicht
verworfen.

Hypothesen (ungeordnet, bugfix klärt):

- **H1**: `maki acp` lädt `init.lua`-Slot-Layer gar nicht (Layer-Mechanik nur
  im TUI/-p-Pfad).
- **H2**: `msg.source` ist im ACP-Pfad weder `"acp"` noch `"headless"`
  (anderer Quellstring → `DRIVEN[msg.source]` falsch).
- **H3**: maki-Update nach 2026-10-29 hat `set_slot`/`run_command`-Semantik
  geändert (API-Drift), Layer still inaktiv.

Nächster Schritt: Diagnose-Sonde — init.lua temporär um eine Zeile ergänzen,
die bei Slot-Aufruf eine Markierung schreibt (Datei/Log), dann `/new` über
den Hub senden und prüfen: Slot gefeuert? `msg.source`? `run_command`-Return?
Erst dann patchen.

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [x] GitLab-Issue angelegt ([#33](https://gitlab.com/SiLenT_Tz/mobile-hub/-/work_items/33))
- [ ] `bugfix`
