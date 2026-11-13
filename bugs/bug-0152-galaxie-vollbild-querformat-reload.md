---
id: BUG-0152
slug: galaxie-vollbild-querformat-reload
status: open
severity: S3
area: pwa
instance: dev
commit: "f92263a"
forge: "https://gitlab.com/SiLenT_Tz/AncientVoid/-/work_items/59"
epic: "P52"
created: 2026-11-13
reporter: agent (P57-Übergabe)
---

# BUG-0152 — Galaxie-Vollbild: Bei 915×412 (Handy quer) überlebt die Graph-Ansicht den Reload nicht

## Gesehen

Nach einem Reload der Repo-Galaxie im Querformat (915×412) zeigt die PWA die
Session-Ansicht (Chat-Tail) statt der Graph-Ansicht; `.graph-pane` existiert
nicht. Im Hochformat (412×915) funktioniert derselbe Ablauf.

## Erwartet

`/#/sessions/<id>/graph` bleibt nach dem Reload die aktive Route, die
Graph-Ansicht erscheint wieder im Vollbild (`data-fullscreen="1"`).

## Repro

Voraussetzung: lokaler Hub mit E2E-Fixtures (Playwright Chromium), eine
`dummy`-Session mit Repo (Standardprojekt).

1. Viewport 412×915 setzen, `/#/sessions/<id>/graph` öffnen → Graph-Vollbild
   erscheint (dieser Schritt funktioniert noch).
2. Viewport auf 915×412 (quer) setzen.
3. Seite neu laden.

**Ergebnis nach Schritt 3:** Session-Ansicht mit Chat-Tail; Playwright-Snapshot
zeigt Navigation, Topbar und Events, keine `.graph-pane`.

**Häufigkeit:** immer (3 von 3 Läufen, auf `main` f92263a und auf dem
T57.9-Branch b477999 reproduziert; E2E-Gate rot in zwei Worktrees).

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | lokal (E2E-Demo-Hub) |
| Commit | `f92263a` (main), `b477999` (T57.9-Branch) |
| Node-Version | v24 (Playwright-Runner) |
| Adapter | dummy |
| Repro-Weg | PWA (Playwright, Projekt `desktop`) |

## Logs

Playwright-Fehlerkontext (Seiten-Snapshot nach Schritt 3, gekürzt):

```text
Error: expect(locator).toHaveAttribute(expected) failed
Locator: locator('.graph-pane')
Expected: "1"
Timeout: 10000ms
Error: element(s) not found
— Seiteninhalt stattdessen: navigation "Sessions" · "Zur Übersicht" ·
  Session-Topbar „Galaxie Vollbild alpha · dummy …" · Chat-Tail (#1 session.created …)
```

## Tests

| Ring | Befehl / Datei | Stand vor dem Fix |
|---|---|---|
| E2E | `e2e/specs/repo-galaxie.spec.ts:44` („System, Zurück-Reihenfolge und Vollbild") | **rot** — Zeile 76 |

Welcher Test **müsste** ohne Fix rot sein? Der oben genannte ist es bereits —
die Lücke ist prozessual: Der Galaxie-Merge (MR !446, `f211664`) kam mit rotem
E2E auf `main`. Kein neuer Test nötig; der Fix muss den bestehenden grün
machen, ohne ihn zu lockern.

## Eingrenzung

`apps/pwa` — Routing/Route-Wiederherstellung nach Reload in Abhängigkeit von
Viewport-Breite (quer 915 px vs. hoch 412 px; vermutet: Graph-Tab wird nur im
schmalen Layout als Route wiederhergestellt, im breiten als Tab ohne
Hash-Route). `file:line` offen — `bugfix` klärt es.

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [x] GitLab-Issue angelegt (Link oben)
- [ ] `bugfix` oder offen lassen
