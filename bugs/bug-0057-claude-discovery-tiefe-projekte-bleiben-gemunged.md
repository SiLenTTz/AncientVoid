---
id: BUG-0057
slug: claude-discovery-tiefe-projekte-bleiben-gemunged
status: done
severity: S3
area: core
instance: dev
commit: "9b6bdde"
forge: "https://gitlab.com/SiLenT_Tz/mobile-hub/-/work_items/15"
epic: ""
created: 2026-10-20
reporter: agent
---

# BUG-0057 — Claude-Discovery lässt tiefer verschachtelte Projekte gemunged

## Gesehen

Claude-Sessions aus tiefer verschachtelten Projekten erscheinen in der
Discovery-Liste (PWA „Entdecken", `hubctl discover`) mit dem gemunged
Verzeichnisnamen (z. B. `-mnt-omarchy-data-30-repos-arch-arbeitsbaeume-mobile-hub`)
statt dem echten Pfad — sie werden dadurch nicht der bekannten Projektgruppe
zugeordnet und sind schlechter wiederzuerkennen.

## Erwartet

Der Projektpfad wird gegen die konfigurierten `projectRoots` zurück-übersetzt,
unabhängig von der Verzeichnistiefe unter dem Root — analog zu opencode-Sessions,
die ihren echten `directory`-Pfad zeigen.

## Repro

Voraussetzung: `~/.claude/projects` enthält Projekte tiefer als eine Ebene
unter einem `projectRoots`-Root; Hub mit passendem `hub.config.json`.

1. `UACC_CONFIG=… node apps/hub/src/main.ts` starten
2. `UACC_URL=… UACC_TOKEN=… node apps/hubctl/src/cli.ts discover`

**Ergebnis nach Schritt 2:** Claude-Zeilen mit `project:
"-mnt-omarchy-data-30-repos-arch-arbeitsbaeume-mobile-hub"` statt
`"/mnt/omarchy_data/30_repos/arch/arbeitsbaeume/mobile-hub"`. Auf der
Repro-Maschine: 174 Projektverzeichnisse, alle gemunged; nur direkte
Root-/Home-Kinder würden entrütschelt.

**Häufigkeit:** immer (strukturabhängig)

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | lokal (127.0.0.1:7391, Testdatadir) |
| Commit | `9b6bdde` |
| Node-Version | v26.7.0 |
| Adapter | claude (Discovery-Quelle `claude-projects`) |
| Repro-Weg | hubctl |

## Logs

```text
$ curl -s -H "Authorization: Bearer …" http://127.0.0.1:7391/api/discovery?limit=5
{"project":"-mnt-omarchy-data-30-repos-arch-arbeitsbaeume-OVerView","adapter":"claude", …}
{"project":"/mnt/omarchy_data/30_repos/arch/arbeitsbaeume/sexbot","adapter":"opencode", …}
```

Claude gemunged, opencode (aus `session.directory`) korrekt — gleicher Hub,
gleicher Lauf.

## Tests

| Ring | Befund / Datei | Stand vor dem Fix |
|---|---|---|
| Unit | `packages/core/test/modules/harness/inventory-scan.test.ts` („maps a munged project dir back…") | grün, deckt nur exakte Kandidaten ab |
| Unit (neu) | `claudeDiscoverySource` löst verschachteltes Projekt auf | rot ohne Fix |

## Eingrenzung

`packages/core/src/modules/discovery/sources.ts:362` —
`knownProjectCandidates` nimmt nur Roots + direkte Kinder (+ Home-Kinder)
als De-Munge-Kandidaten; `unMungeProject` (L79) ist ein exakter
String-Vergleich. Tiefe = kein Treffer = gemunged Name bleibt.

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [x] GitLab-Issue angelegt (Link oben)
- [x] `bugfix` angewiesen
