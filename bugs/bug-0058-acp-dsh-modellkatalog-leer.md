---
id: BUG-0058
slug: acp-dsh-modellkatalog-leer
status: done
severity: S2
area: adapters
instance: prod
commit: ""
forge: ""
epic: "P7"
created: 2026-10-21
reporter: jan
---

# BUG-0058 — dsh: Modellauswahl am Handy bleibt leer

## Gesehen

Beim Start einer `deepseek`-Session (ACP-Preset `dsh`) bietet die PWA keine Modelle
an. `GET /api/adapters/deepseek/models` liefert `models: null`, im Hub-Log steht
bei jeder Anfrage `Command failed: dsh --profile models … profile "models" does not exist`.

## Erwartet

Alle Provider und Modelle, die `dsh` kennt, stehen zur Auswahl; das konfigurierte
Default-Modell (`model` in der Adapter-Config) wird gestartet.

## Repro

1. `dsh` ≥ 0.2 installieren (0.2.1-rc.2), Hub mit `{"preset":"dsh"}` starten.
2. `GET /api/adapters/deepseek/models`.

**Ergebnis nach Schritt 2:** `models: null`, Warnung im Log.

**Häufigkeit:** immer

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | Produktiv-Hub, Sidecar-Hub |
| dsh | 0.2.1-rc.2 |
| Adapter | deepseek (acp, preset dsh) |
| Repro-Weg | HTTP-API |

## Logs

```text
Error: dsh: profile "models" does not exist; create it with 'dsh plugin --profile models add <package>'
```

## Tests

| Ring | Befehl / Datei | Stand vor dem Fix |
|---|---|---|
| Adapter | `packages/adapters/acp/test/adapter.test.ts` „dsh preset: models() …" | rot ohne Fix (`[]`) |
| Unit/Probe | `packages/adapters/acp/test/catalog.test.ts` (echte dsh-0.2.1-Form, Agent-Prozess, Fehlerfall) | neu |

## Eingrenzung

`packages/adapters/acp/src/index.ts`, `models()`: leitete aus `dsh --profile acp` den Befehl
`dsh --profile models` ab. Seit dsh 0.2 gibt es dieses Profil nicht mehr; der Katalog kommt aus
ACP `session/new` (`configOptions`, Rest als `config_option_update`).

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [x] Fix in derselben MR
- Betrieb: Das Profil `acp` unter `~/.dsh/profiles/acp` braucht den Patch für Provider `zai` und Default
  `glm-5.3` (wie `dsh-tui`), sonst fehlen die GLM-Modelle in der Liste.
