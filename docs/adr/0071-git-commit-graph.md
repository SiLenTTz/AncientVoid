# ADR-0071 — Git-Commit-Graph (Branches, Merges, Datei-Sprung)

**Status:** akzeptiert · **Betrifft:** `packages/contracts/src/git-graph/`,
`packages/core/src/modules/git-graph/`, `apps/hub/src/modules/git-graph/`,
`apps/pwa/src/features/git-graph/`, Session-Tab „Git“

## Kontext

Der bestehende Repo-Graph (ADR-0062 / EPIC-P48) zeigt Datei-Importkanten, nicht
den Commit-DAG. Die Diff-Route (`GET /api/sessions/:id/diff`) liefert Commits
seit `baseRef` ohne Eltern-SHAs und ohne Branch-Refs — zu wenig für eine
farbige Git-Graph-Ansicht (Vorbild VS-Code „Git Graph“). Der Nutzer will
Branches/Merges sehen und aus einem Commit direkt in den Projekt-Explorer
springen.

## Entscheidung

1. **Eigener Contract** `GitGraphReport` in `packages/contracts/src/git-graph/`:
   Commits mit `parents`, `refs`, gekappten `files`; `branches` mit
   `colorIndex`; ehrliche Caps (`GIT_GRAPH_MAX_COMMITS`,
   `GIT_GRAPH_MAX_FILES_PER_COMMIT`) und `truncated`/`filesTruncated`/`error`.
2. **Core-Modul** `packages/core/src/modules/git-graph/`: `git log --all`
   (Parents + Name-Status) und `git for-each-ref` — read-only, Timeout,
   kein Shell. Keine Vermischung mit dem Datei-Import-Graph.
3. **HTTP** `GET /api/git-graph?session=`/`?project=` — dieselbe
   Zielwahl/Containment-Policy wie `/api/graph` und Code-Routen.
4. **PWA**: neuer Session-Tab „Git“; Layout (Lanes) clientseitig; Datei-Klick
   öffnet den Projekt-Explorer (`FilesLayer`) auf dem Pfad der Session.
5. **Kein Adapter-/Event-Contract** — reine HTTP-Antwort; K7 unberührt.

## Alternativen

- **Diff-API erweitern**: falsche Semantik (Session-Delta vs. Repo-Verlauf) —
  abgelehnt.
- **Datei-Graph umbenennen/überladen**: verwirrend gegenüber ADR-0062 —
  abgelehnt.

## Folgen

- Große Repos werden sichtbar gekappt; die PWA zeigt das.
- Lane-Farben sind UI-Palette, stabil über `colorIndex` der Branch-Liste.
