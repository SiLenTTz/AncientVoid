---
id: BUG-0191
slug: git-historie-datei-oeffnet-nur-workdir
status: done
severity: S2
area: pwa
instance: dev
commit: "f5fbed08"
forge: "https://github.com/SiLenTTz/AncientVoid/issues/74"
epic: ""
created: 2026-11-17
reporter: "Nutzerbeobachtung Git-Struktur"
---

# BUG-0191 — Datei aus der Git-Historie öffnet nur den Worktree-Stand (404 bei alt/gelöscht)

## Gesehen

Im Git-Graph einen Commit aufklappen und eine geänderte Datei anklicken:
der Dateibaum/Viewer versucht den **aktuellen** Worktree-Pfad. Fehlt die
Datei dort (gelöscht, umbenannt, nur in altem Commit), kommt:

`file not found, not a regular file, or outside the workspace`

Alte Stände sind damit nicht nachvollziehbar — auch wenn die Datei im
Commit noch existierte.

## Erwartet

Klick auf eine Datei eines Commits zeigt den Inhalt **dieser Revision**
(`git show <sha>:path` / Blob), auch wenn die Datei im HEAD fehlt oder
anders heißt. Gelöschte Pfade bleiben lesbar; Rename nutzt den im
Name-Status genannten Pfad der Revision. Klartext statt nacktem 404, wenn
wirklich kein Blob existiert.

## Repro

Voraussetzung: Repo mit mindestens einem Commit, der eine später gelöschte
oder stark geänderte Datei berührt; Session auf dem Projekt.

1. Git-Struktur öffnen, älteren Commit mit Dateiliste aufklappen.
2. Datei anklicken, die im aktuellen Worktree nicht mehr (oder anders) liegt.

**Ergebnis nach Schritt 2:** Explorer/Viewer-Fehler
`file not found, not a regular file, or outside the workspace`
(`apps/hub/src/modules/code/code.routes.ts` → `containedFile` auf HEAD-Tree).

**Ursache (Eingrenzung):** `GitGraphPane.openInExplorer` dispatcht nur
`path` + `sessionId`, ohne Commit-SHA
(`apps/pwa/src/features/git-graph/GitGraphPane.tsx`). ADR-0071 §4 beschreibt
bewusst den Sprung in den Projekt-Explorer — für Historie-Stände unzureichend.

**Häufigkeit:** immer bei Dateien, die im HEAD fehlen; auch verwirrend bei
vorhandenen Dateien (zeigt HEAD, nicht den Commit-Inhalt).

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | lokal |
| Commit | `f5fbed08` |
| Node-Version | v26.7.0 |
| Adapter | — |
| Repro-Weg | Code-Pfad + Nutzerbeobachtung PWA |

## Logs

```text
GET /api/code/file?session=…&path=<historischer-pfad>
→ 404 {"error":"file not found, not a regular file, or outside the workspace"}
```

Kein Secret; Fehlertext aus `code.routes.ts`.

## Tests

| Ring | Befehl / Datei | Stand vor dem Fix |
|---|---|---|
| Unit/Integration | Hub: Datei @ SHA (neu) | nicht vorhanden |
| E2E | `e2e/specs/git-graph.spec.ts` | Datei-Klick prüft keinen historischen Inhalt |

Ohne Fix: Klick auf gelöschte Historie-Datei muss 404 bzw. leeren Viewer
liefern — Assert darauf rot-dann-grün.

## Eingrenzung

- `apps/pwa/src/features/git-graph/GitGraphPane.tsx` — SHA mitgeben
- Code-/Blob-API: Revision/SHA-Parameter (Contract + Core), nicht nur Worktree
- Dateibaum: Historie-Ansicht oder Inline-Viewer für Blob @ SHA
- verwandt: BUG-0190 (Graph-Lesbarkeit)

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [x] GitHub-Issue angelegt (`forge:`)
- [ ] offen — eher Feature-Lücke zu ADR-0071 als gelöschte Datei; Historie-Blob fehlt
