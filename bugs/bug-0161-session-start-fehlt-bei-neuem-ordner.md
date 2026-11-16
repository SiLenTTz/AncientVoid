---
id: BUG-0161
slug: session-start-fehlt-bei-neuem-ordner
status: open
severity: S2
area: core
instance: dev
commit: "3aef99e5"
forge: ""
epic: ""
created: 2026-11-16
reporter: Pi-Session 2026-11-16 (Nutzerbericht + Browser-Repro)
---

# BUG-0161 — Session-Start in einem Ordner, den es noch nicht gibt, scheitert mit falscher Begründung

## Gesehen

Wer in „Neue Session“ einen Pfad innerhalb einer konfigurierten
`projectRoots`-Wurzel angibt, den es noch nicht gibt, bekommt
`project path is outside the configured projectRoots` — der Ordner wird nicht
angelegt, es entsteht keine Session. Die Meldung behauptet etwas anderes als
die Ursache (der Pfad *liegt* in der Wurzel, er existiert nur nicht).

## Erwartet

Ein Pfad innerhalb einer erlaubten Wurzel darf startbar gemacht werden:
entweder legt der Hub den Blattordner an (Elternexistenz geprüft), oder die
Meldung nennt ehrlich „Ordner existiert nicht“ und bietet das Anlegen an.
Beides ist gemeint: mehrere Sessions in einem vorhandenen Ordner **und** ein
neuer Ordner, falls er noch fehlt.

## Repro

Voraussetzung: Hub mit `projectRoots: ["<temp>/projects"]`, darin
`gitrepo/` (mit `.git`) und `plain-ordner/` (ohne `.git`), Adapter `dummy`,
PWA im Browser.

1. „Neue Session“ öffnen, Adapter `dummy` belassen.
2. Im Feld **Pfad** `<temp>/projects/neu-ordner` eintragen (existiert nicht).
3. „Starten“ klicken.

**Ergebnis nach Schritt 3:** Fehler `project path is outside the configured
projectRoots`; `GET /api/sessions` liefert `[]`; unter `projectRoots` liegen
weiter nur `gitrepo` und `plain-ordner` (nichts angelegt).

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
PWA-Meldung nach „Starten“ (role=status, Formular):
  project path is outside the configured projectRoots
GET /api/sessions -> 200 []
Verzeichnis projectRoots nach dem Versuch: ['gitrepo', 'plain-ordner']
```

## Tests

| Ring | Befehl / Datei | Stand vor dem Fix |
|---|---|---|
| Unit | `packages/core/test/project-allowlist.test.ts` (neu) | fehlt |
| Integration | `apps/hub/test/server.test.ts` (Session-POST mit fehlendem Blattordner) | fehlt |
| E2E | `e2e/specs/neue-session.spec.ts` (neu) | fehlt |

Ohne Fix rot sein müsste ein Unit-Test auf `isProjectPathAllowed()` mit einem
unterhalb der Wurzel liegenden, aber nicht existierenden Pfad, plus ein
Integrations-test für den Session-POST in einen frischen Ordner.

## Eingrenzung

`packages/core/src/modules/workspace/projects.ts:73-93`
(`isProjectPathAllowed` löst per `realpath()` auf; für einen nicht
existierenden Pfad wirft das und die Funktion antwortet `false` →
„außerhalb der Wurzeln“). Aufrufer: Session-Start in
`packages/core/src/modules/sessions/session-manager.ts` und
`apps/hub/src/modules/sessions/sessions.routes.ts`. Verwantter Fund in
BUG-0165 (Windows-Pfadvergleich) — ein auf Windows getipptes `/coding` löst zu
`E:\Coding` auf (`checkout_id` in `data/hub.db` belegt das), das hier
mitgedacht werden muss.

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [ ] GitLab-Issue angelegt (Link oben)
- [ ] `bugfix` (auf diesem Branch)
