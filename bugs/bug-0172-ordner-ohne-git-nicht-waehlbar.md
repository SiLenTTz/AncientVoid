---
id: BUG-0172
slug: ordner-ohne-git-nicht-waehlbar
status: done
severity: S3
area: core
instance: dev
commit: "3aef99e5"
forge: ""
epic: ""
created: 2026-11-16
reporter: Pi-Session 2026-11-16 (Nutzerbericht + Browser-Repro)
---

# BUG-0172 — Ordner ohne `.git` erscheinen nie in der Projektauswahl

## Gesehen

Die Projektauswahl in „Neue Session“ zeigt nur Ordner mit `.git`. Ein
Ordner derselben konfigurierten Wurzel ohne `.git` ist dort nicht wählbar —
er muss jedes Mal von Hand ins Freitextfeld „Pfad“ getippt werden, und der
Hub merkt ihn sich nicht (siehe BUG-0173).

## Erwartet

Wer ohne Git arbeitet (Kais Standard auf diesem Rechner: „ich arbeite
meistens ohne gitlab oder irgendein git“), bekommt seine Ordner genauso zur
Auswahl wie Git-Ordner — der Arbeitsort „Projekt direkt“ ist für sie der
einzige ehrliche Weg und wird vom Hub auch selbst so vorbelegt
(„Nicht möglich: kein Git-Projekt“).

## Repro

Voraussetzung wie in BUG-0171: `projectRoots` auf ein Verzeichnis mit
`gitrepo/` (mit `.git`) und `plain-ordner/` (ohne `.git`).

1. PWA öffnen, „Neue Session“.
2. Das Auf Feld **Projekt** aufklappen.

**Ergebnis nach Schritt 2:** Auswahl enthält nur `gitrepo (main)`;
`plain-ordner` fehlt. Worktree-Karte sagt für einen manuell getippten
`plain-ordner`-Pfad korrekt „Nicht möglich: kein Git-Projekt“, der Ordner ist
aber trotzdem nirgends auffindbar.

**Häufigkeit:** immer

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | Scratch-Hub (eigener dataDir, Port 62883) auf `127.0.0.1` |
| Commit | `3aef99e5` |
| Node-Version | v24.18.0 |
| Adapter | dummy |
| Repro-Weg | PWA (agent-browser, Chromium) |

## Logs

```text
DOM der Formularseite (Projekt-Combobox):
  combobox "Projekt": gitrepo (main)
    option "gitrepo (main)"
Dateien unter <temp>/projects: gitrepo/ (.git vorhanden), plain-ordner/ (nur Notiz.md)
```

## Tests

| Ring | Befehl / Datei | Stand vor dem Fix |
|---|---|---|
| Unit | `packages/core/test/projects.test.ts` | grün, aber deckt „ohne `.git`“ nur als *nicht-Projekt* ab |
| Contract | — | |
| E2E | `e2e/specs/neue-session.spec.ts` (neu) | fehlt |

Ein Unit-Test auf `discoverProjects()` mit einem Wurzel-Kind ohne `.git` müsste
ohne Fix rot sein, sobald Nicht-Git-Ordner erwartet werden.

## Eingrenzung

`packages/core/src/modules/workspace/projects.ts:48-58` —
`discoverProjects()` verwirft jedes Wurzel-Kind ohne `.git`
(Kommentar: „no .git -> not a project, depth 1 only“). Vertragsseite:
`DiscoveredProject` in `packages/contracts` (Feld `branch` ist für Nicht-Git
sinnlos `null`) — eine Aufnahme braucht eine Entscheidung, ob
`projectKinds`/`isGit` ergänzt wird (ADR-Pflicht nach AGENTS §1).

## Fix (`525e9660`)

`discoverProjects` listet jede
unmittelbare Untermappe mit `isGit` (Git-Repos zuerst), `DiscoveredProject`
bekommt das Feld; Dateien, Symlinks und versteckte Ordner bleiben draussen, eine
geflutete Wurzel wird bei 200 gekuerzt und die Kuerzung als Warnung
zurueckgegeben, die PWA haengt die Warnungen sichtbar an.

## Tests

`projects.test.ts`: Reihenfolge + `isGit`, Tiefe 1, kein Symlink, keine Datei;
Cap-Test mit Warnung. Live: Dropdown zeigte `plain-ordner`, Session `19bf1be1`
direkt darin gestartet.

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [ ] GitLab-Issue angelegt (Link oben)
- [ ] `bugfix` (auf diesem Branch)
