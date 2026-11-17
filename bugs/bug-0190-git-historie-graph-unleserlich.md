---
id: BUG-0190
slug: git-historie-graph-unleserlich
status: done
severity: S3
area: pwa
instance: dev
commit: "f5fbed08"
forge: "https://github.com/SiLenTTz/AncientVoid/issues/73"
epic: ""
created: 2026-11-17
reporter: "Nutzerbeobachtung Git-Struktur"
---

# BUG-0190 — Git-Historie: Lane-Linien, Farben und Worktree-Namen unleserlich

## Gesehen

Die Ansicht „Git-Struktur“ / Git-Graph (ADR-0071) wirkt kaputt bzw. unklar:

1. Branch-Linien sind nicht sauber miteinander verbunden (Lücken/Versatz
   zwischen Zeilen).
2. Alle Branch-Köpfe stapeln sich optisch ganz oben übereinander, statt
   nachvollziehbar auseinanderzulaufen und wieder zusammenzukommen.
3. Farben der Lanes/Refs haben keine Legende — unklar, was welche Farbe sagt.
4. Worktree-Branches heißen nur `ancientvoid/<uuid>` (reine Session-ID) —
   kein Session-Titel, kein Kurzlabel.

## Erwartet

- Lane-Layout wie übliche Git-Graph-UIs: durchgehende Vertikalen, erkennbare
  Forks/Merges, keine optisch „abrissenden“ Kanten zwischen Zeilen.
- Kurze Legende oder Tooltip: Farbe ↔ Branch/Ref (oder „Lane n“).
- Worktree-Refs: Rohname darf `ancientvoid/<sessionId>` bleiben (das ist die
  echte Branch-Benennung in `WorktreeManager`) — die **Anzeige** soll aber
  lesbar sein (Session-Titel / gekürzte ID mit Hover auf den vollen Ref).

## Repro

Voraussetzung: Projekt mit mehreren Branches inkl. Session-Worktrees
(`ancientvoid/<uuid>`).

1. PWA → Git-Struktur (Dock) oder Session-Tab Git öffnen.
2. Graph mit ≥2 Branches / Merge-Historie betrachten.
3. Branch-Chips oben und Lane-Farben mit den Linien abgleichen.

**Ergebnis:** Linien wirken nicht verbunden; viele farbige Tips oben;
keine Legende; Worktree-Chips nur UUID.

**Häufigkeit:** immer (bei Repos mit mehreren Refs besonders auffällig)

**Absicht Branch-Namen:** Ja — `ancientvoid/<sessionId>` ist absichtlich
(`packages/core/src/modules/workspace/worktree.ts`). Der Mangel ist die
**UI-Beschriftung**, nicht die Git-Benennung.

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | lokal |
| Commit | `f5fbed08` |
| Node-Version | v26.7.0 |
| Adapter | — |
| Repro-Weg | Nutzerbeobachtung PWA; Layout in `apps/pwa/src/features/git-graph/layout.ts` |

## Logs

Kein Hub-Fehler — reine Darstellung.

```text
# Refs kommen roh aus for-each-ref (buildGitGraph)
# Lane-Farben: GIT_LANE_COLORS / colorIndex — ohne UI-Legende
```

## Tests

| Ring | Befehl / Datei | Stand vor dem Fix |
|---|---|---|
| Unit | `apps/pwa/test/features/git-graph/layout.test.ts` | nur Merge/Lane-Zählung, keine Verbindungs-/Lesbarkeitsasserts |
| E2E | `e2e/specs/git-graph.spec.ts` | vorhanden, prüft nicht Legende/Worktree-Label |

## Eingrenzung

- `apps/pwa/src/features/git-graph/layout.ts` — Lane-/Edge-Geometrie
- `apps/pwa/src/features/git-graph/GitGraphPane.tsx` — SVG-Rails, Branch-Chips, Legende
- optional Core/API: Session-Titel zu `ancientvoid/<id>` auflösen (Anzeige only)

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [x] GitHub-Issue angelegt (`forge:`)
- [ ] offen — eng verwandt mit BUG-0191 (Datei-Sprung)
