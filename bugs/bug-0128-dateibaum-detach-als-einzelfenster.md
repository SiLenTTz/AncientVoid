---
id: BUG-0128
slug: dateibaum-detach-als-einzelfenster
status: done
severity: S3
area: pwa
instance: dev
commit: "efaa952"
forge: ""
epic: ""
created: 2026-11-11
reporter: "Nutzer"
---

# BUG-0128 — Herauslösen von Projektbaum/offenen Dateien erzeugt Einzeldatei-Fenster statt einem gebündelten Fenster

## Gesehen

Zieht man den Projektbaum (rechte Datei-Seitenleiste) oder eine offene Datei in ein eigenes Fenster, entstehen
Einzel-Fenster je Datei (⧉ am Datei-Tab öffnet `{kind:"file"}` mit nur genau einer Datei). Eine Drag-Geste zum
Herauslösen der Seitenleiste existiert gar nicht. Baum und offene Dateien werden nie als gemeinsames Fenster angeboten.

## Erwartet

Herauslösen (Drag über den Fensterrand oder ⧉) erzeugt **genau ein** Fenster, das den Projektbaum **und alle
geöffneten Dateien** (Tabs + Dateiansicht) gemeinsam zeigt — nie Einzeldatei-Fenster. Erneutes Herauslösen fokussiert
das bestehende Fenster (ein Ziel — ein Fenster, ADR-0053).

## Repro

Voraussetzung: Hub läuft, Desktop ≥ 1280 px, eine Session mit Worktree.

1. `Ctrl+Shift+E` öffnet die rechte Datei-Seitenleiste.
2. Datei im Baum öffnen → Datei-Tab erscheint.
3. ⧉ am Datei-Tab klicken.

**Ergebnis nach Schritt 3:** Fenster nur mit dieser einen Datei (URL `…/datei/<path>`), ohne Baum und ohne die
anderen offenen Dateien. Drag aus dem Fenster heraus löst nichts aus.

**Häufigkeit:** immer.

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | lokal (`127.0.0.1:7373`) |
| Commit | `efaa952` |
| Node-Version | 26.7.0 |
| Adapter | beliebig |
| Repro-Weg | PWA |

## Logs

Keine Server-Beteiligung — rein clientseitiges Verhalten (`apps/pwa/src/features/files/FilesSidebar.tsx:211`,
`apps/pwa/src/features/windows/protocol.ts` fehlt ein Ziel für die gebündelte Seitenleiste).

## Tests

| Ring | Befehl / Datei | Stand vor dem Fix |
|---|---|---|
| Unit | `apps/pwa/test/features/windows/protocol.test.ts` (files-Ziel) | rot (Ziel unbekannt) |
| Unit | `apps/pwa/test/app/route.test.ts` (`#/dateibaum`) | rot (Route unbekannt) |
| E2E | `e2e/specs/repo-graph.spec.ts` (T46.8-Rest), `e2e/specs/windows.spec.ts` (Drag) | Expectation auf Einzeldatei-Fenster |

## Ursache (nach Analyse)

- `FilesSidebar` öffnet je Tab `{kind:"file"}` — es existiert kein `WindowTarget`, das die Seitenleiste als Ganzes zeigt.
- Die Ziehgeste (ADR-0053 `pointerOutside`) ist nur an Kachel-Griffe gebunden (`TileWorkspace.tsx:216`), nicht an die
  Datei-Seitenleiste.
