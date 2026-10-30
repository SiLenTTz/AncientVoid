# Factory-Schnittstelle securesight-factory ↔ Hub (EPIC-P26)

**Version dieses Vertrags: 1** · gilt für `securesight-factory` ab `bd8228d`
(CLI `factory`). **Stabilität:** Die Factory ist in Bewegung (Iteration 0056+).
Jede Quelle trägt ihre `schema_version`; der Hub prüft sie und reagiert auf
Unbekanntes mit `loop.broken` samt Grund — nie still (K9, Regel 6). Ändert die
Factory eine Quelle, hebt sie deren `schema_version`; dieser Vertrag wird
mitgeführt (Version hier =_maximum der gelesenen Schemata_).

Rollen: Der **Hub liest** Dateien und ruft dokumentierte CLI-Kommandos auf
(`execFile`, feste Argumentliste, Zeitlimit). Der **Hub schreibt nie** in
Projektdateien; gesetzt wird ausschließlich durch `factory init` (vom Menschen
ausgelöst) und den Treiber (Claude-Session mit `/factory`). Provider-Keys,
Trust und Berechtigungen liegen allein bei der Factory — der Hub liest,
speichert und loggt sie nie (AC-P26-7).

## Modi-Erkennung

| Modus | Erkennung | Nutzung |
|---|---|---|
| `repo` | `scripts/betrieb.py` vorhanden | Factory-Repo selbst (bestehend, unverändert; Supervisor-Pfad) |
| `project` | `.factory/config.json` vorhanden **und kein** `scripts/betrieb.py` | Zielprojekt eines Laufs (neu in P26) |

Beides vorhanden ⇒ Modus `repo`. Weder noch ⇒ kein Factory-Projekt
(`start()` lehnt ab, wie bisher).

## Kommandos (Aufruf immer `execFile`, Argumentliste fest, ohne Shell)

### `factory init` — Projekt anlegen/rekonfigurieren

```
factory init --root <pfad> [--from-prd <pfad>] --modus a|b --provider anthropic|zai [--reconfigure]
```

- **stdout: genau eine JSON-Zeile.** Die menschenlesbare Checkliste
  („factory bootstrap-checkliste: …`) geht auf **stderr** — es wird nur stdout
  geparst, stderr darf zusätzlich angezeigt werden.
- **Exit 0** bei Erfolg. Fehlerfall: Exit ≠ 0, Meldung auf stderr (Grund
  zeigen, nie still — AC-P26-1).
- JSON (schema dieser Ausgabe: `checkliste`-basiert, ohne eigene
  `schema_version` — Version folgt mit dem dokumentierten Exit-Code-Vertrag,
  siehe „Offene Wünsche“):

| Feld | Typ | Bedeutung |
|---|---|---|
| `root` | string | Projektwurzel (wie übergeben) |
| `created` | string[] | angelegte Dateien (relativ) |
| `skill` | string[] | projektlokaler `/factory`-Skill (`.claude/skills/factory/SKILL.md`) |
| `context` | objekt | `mode`, `has_git`, `markdown_files` |
| `inventory` | objekt | Bestandsaufnahme, `schema_version "1"`, read-only |
| `wizard` | objekt | `modus` (a\|b), `provider` (anthropic\|zai), `quelle` |
| `session` | objekt | Status der Session-Freigabe (`Bash(factory:*)`) |
| `trust` | objekt | Trust-Status; **`ready` nur wenn trust ok und provider ok** (REQ-3001) |
| `git` | objekt | Repo-Status |
| `checkliste` | string[] | Zeilen wie im stderr-Block; „bereit“ ⇔ Zeile `ready: …` vorhanden |

### `factory init --status` — Zustand lesen (Resume), legt nichts an

stdout: eine JSON-Zeile `{root, status, execution_ready, next_action, manifest}`.
`status` z. B. `intake`; `execution_ready: false` ⇒ Lauf darf noch nicht
starten.

### `factory progress show` — Fortschritt (Quelle: `stories.md` + `progress.json`)

stdout: eine JSON-Zeile, `schema_version "1"`:

```json
{"schema_version":"1","total":0,"done":0,"stories":[],"now":null,"updated_at":null,"events":[]}
```

`now`/`events` sind während eines Laufs gefüllt (`phase`, `story`, `task`).

## Dateien unter `.factory/` (Modus `project`)

| Datei | `schema_version` | Felder | Bedeutung |
|---|---|---|---|
| `config.json` | `"1"` | siehe unten | Erkennungsmarker + Betriebssuite/-regeln (suites, protect, allow, remote_push, auto_merge, modus, provider) |
| `lauf-status.json` | `"1"` | `task`, `phase`, `heartbeat_at` (Unix-s) | Dead-Man-Signal (REQ-2903); Phase über `pre_task` hinaus **oder** ein jüngerer Vertrag in `contracts/` = echter Fortschritt — deterministisch ohne Log-Parsen |
| `evidence/bootstrap-fehler.json` | `"1"` | `zeit` (ISO), `grund`, `fundstelle` | Pre-Task-Scheitern als Beleg statt stilllem „success“ (REQ-2903) |
| `evidence/lauf-ende-fehler.json` | `"1"` | `zeit`, `grund`, `fundstelle` | Lauf endete mit `permission_denials > 0` ohne Fortschritt (der „Treiber hing in Berechtigungen“-Fall) |
| `intake/state.json` | `"1"` | `status`, `execution_ready`, `source_mode`, `next_action` | Intake-Zustand; identische Aussage wie `factory init --status` |
| `progress.json` | `"1"` | `now`, Ereignisprotokoll | wird von `factory progress show` gelesen (Hub nutzt das Kommando, nicht die Datei direkt) |

**Keine Secrets:** Keine dieser Dateien enthält Provider-Keys oder Tokens
(`config.json` führt nur Suite-/Forge-Einstellungen). Der Hub prüft das im
Leak-Test (AC-P26-7) trotzdem bei jeder Quelle.

## Moduswechsel (project)

```
factory init --root <pfad> --reconfigure --modus a|b --provider <p>
```

Außenwirkung: Modus `a` merged automatisch (`auto_merge`) ⇒ im Hub nur durch
einen Menschen mit Bestätigungsdialog auslösen (AC-P26-5).

## Fehler-/Ausfallregeln für den Hub (Modus `project`)

- Fehlendes `factory`-Binary, Exit ≠ 0, kaputtes JSON, unbekannte
  `schema_version` ⇒ je Quelle ein `loop.broken` mit Grund; die übrigen
  Quellen laufen weiter; sichtbar in < 60 s (AC-P26-4).
- `heartbeat_at` älter als das Lauf-Fenster ohne Phase-Wechsel ⇒ „wartet ohne
  Fortschritt“ (nicht „läuft“) — Premortem 2.
- Ausnahme- und stderr-Texte kürzen (≤ 200 Zeichen), Pfade gegen die
  Projektauswahl prüfen (kein `..`).

## Fixtures

`packages/loops/securesight-factory/test/fixtures/project/` — Herkunft:

| Datei | Herkunft |
|---|---|
| `init.json` | echt: `factory init --modus a --provider zai` (2026-10-30, bd8228d), root-Pfad anonymisiert |
| `init-status.json` | echt: `factory init --status` |
| `progress-show-initial.json` | echt: `factory progress show` direkt nach init |
| `.factory/intake-state.json` | echt: Kopie aus demselben Lauf |
| `.factory/lauf-status.json` | echt: erzeugt von `harness.bootstrap.lauf_status()` |
| `.factory/evidence/bootstrap-fehler.json` | echt: erzeugt von `harness.bootstrap.fehlerbeleg()` |
| `.factory/evidence/lauf-ende-fehler.json` | abgeleitet: gleiches Schema (`bootstrap.py:340`), `grund`/`fundstelle` aus dem dokumentierten Auslösepfad — wird beim ersten echten Lauf ersetzt (T26.10/T26.11) |

Alle anonymisiert und secret-gescannt (Muster `token|api[-_]?key|password|secret|bearer`);
nie Roh-Logs committen.

## Offene Wünsche an die Factory (nicht blockierend, EPIC-P26 §3.6)

1. `factory capabilities --json` (Harnesses, Provider, Version) — bis dahin
   bleibt die Harness-Wahl im Hub ausgeblendet mit Grund (AC-P26-9).
2. ~~`schema_version` in `lauf-status.json` und Fehlerbelegen~~ — **erfüllt**
   ab bd8228d: beide tragen `schema_version: "1"`.
3. Dokumentierter Exit-Code-/JSON-Vertrag für `factory init` und
   `factory progress show` factory-seitig (dieses Dokument beschreibt das
   faktische Verhalten; ein factory-eigener Vertrag bleibt gewünscht).
