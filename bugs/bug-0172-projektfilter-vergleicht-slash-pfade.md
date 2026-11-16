---
id: BUG-0172
slug: projektfilter-vergleicht-slash-pfade
status: done
severity: S2
area: core
instance: dev
commit: "3aef99e5"
forge: ""
epic: ""
created: 2026-11-16
reporter: Pi-Session 2026-11-16 (Nutzerbericht + Code-/Datenbefund)
---

# BUG-0172 — `outsideRoots()` vergleicht mit `/` und filtert auf Windows alles weg

## Gesehen

`outsideRoots(project, roots)` prüft
`project === root || project.startsWith(`${root}/`)`. Windows-Pfade sehen
`E:\Coding\…` aus, deshalb gilt **jeder** Windows-Pfad unterhalb einer
konfigurierten Wurzel als „außerhalb“, sobald `projectRoots` gesetzt ist.
Folge: die native Entdeckung (pi/codex/copilot/hermes/maki) verliert alle
Treffer. Kais `hub.config.json` dokumentiert den Workaround bereits —
`projectRoots` bleibt bewusst leer, „weil `outsideRoots()` mit `'/'`
vergleicht und unter Windows sonst jede Pi-Session unterhalb eines Roots
aussortiert“. Damit ist zugleich die Allowlist von T1.5-4 außer Kraft
(leere Wurzeln = jeder Pfad erlaubt), was BUG-0169/0170 verstärkt: es gibt
weder Vorschläge noch Anlegen, und jeder Start braucht von Hand einen Pfad.

## Erwartet

Der Wurzelvergleich ist plattformgerecht (Trennzeichen auf beiden Seiten
normalisieren, kanonisch auflösen; auf Windows zusätzlich Groß-/Kleinschreibung
und Laufwerks-/UNC-Form beachten), damit `projectRoots` auf Windows gesetzt werden kann,
ohne die Entdeckung zu löschen.

## Repro

Voraussetzung: Windows (dieser Rechner), Hub mit gesetzten `projectRoots`.

1. `node -e` gegen `packages/core`:
   `outsideRoots("E:\\\\Coding\\\\projekt", ["E:\\\\Coding"])`
2. Ergebnis beobachten.
3. In Kais `data/hub.db` (read-only): die vier bestehenden Sessions liegen
   samtlich unter `E:\…` bzw. `C:\Users\…`.

**Ergebnis nach Schritt 2:** `true` („außerhalb“) für einen Pfad, der
innerhalb der Wurzel liegt.

**Häufigkeit:** immer auf Windows mit gesetzten Wurzeln

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | Windows 11 (kaisgamingdesk), Hub `127.0.0.1:7373` |
| Commit | `3aef99e5` |
| Node-Version | v24.18.0 |
| Adapter | pi |
| Repro-Weg | Codeausführung (`node -e`) + SQLite-Read-only-Befund; UI-Folgewirkung in BUG-0169/0170 |

## Logs

```text
packages/core/src/modules/discovery/text.ts:56-58
  export function outsideRoots(project, roots) {
    return roots.length > 0 && !roots.some((root) => project === root || project.startsWith(`${root}/`));
  }
hub.config.json (Kommentar des Nutzers, gekürzt):
  "projectRoots bewusst leer: outsideRoots() vergleicht mit '/' und filtert
   unter Windows sonst jede Pi-Session unterhalb eines Roots aus"
data/hub.db: projects "E:\coding\AncientVoid", "E:\Coding\qwen 4",
  "C:\Users\KaiFe\Documents\hardwareauswahl", "/coding"
  (checkout_leases dazu: "E:\Coding" — ein auf Windows getipptes "/coding"
   löste nach E:\Coding auf, Laufwerksrelativ; meldet nie einen Fehler)
```

## Tests

| Ring | Befehl / Datei | Stand vor dem Fix |
|---|---|---|
| Unit | `packages/core/test/discovery-roots.test.ts` | fehlt für Windows-Pfade |
| Integration | — | |

Ein Unit-Test mit Windows-Pfadpaaren (`E:\\Coding` /
`E:\\Coding\\projekt`, gemischte Schrägstriche, Groß-/Kleinbuchstaben) wäre
ohne Fix rot.

## Eingrenzung

`packages/core/src/modules/discovery/text.ts:56-58` (Aufrufer:
`codex.ts:152`, `copilot.ts:82`, `hermes.ts:76`, `maki.ts:94`,
`pi-family.ts`). Nah verwandt: `isProjectPathAllowed()` in
`packages/core/src/modules/workspace/projects.ts:73-93` nutzt `realpath` und
`startsWith(realRoot + sep)` — richtig, aber trennzeichen-/laufwerkskritisch
und wirft bei nicht existierendem Pfad (BUG-0168).

## Fix (`195eec2a`)

`packages/core/src/platform/paths.ts`
mit `pathWithin(pathStyle)`/`nearestExistingAncestor`/`pathStyle`; `outsideRoots()`
nutzt `pathWithin` statt `startsWith(root + "/")`.

## Tests

`packages/core/test/platform/paths.test.ts` (5 Faelle: Windows Gross-/Kleinkopf,
gemischte Trennzeichen, anderes Laufwerk, `..`-Ausstieg, POSIX-Stil als
Parameter). Altes Verhalten war nachgerechnet `true` fuer `E:\Coding\projekt`
unter `E:\Coding`.

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [ ] GitLab-Issue angelegt (Link oben)
- [ ] `bugfix` auf diesem Branch (setzt Kais `projectRoots`-Workaround außer Kraft)
