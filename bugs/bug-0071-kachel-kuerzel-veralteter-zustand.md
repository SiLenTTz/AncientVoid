---
id: BUG-0071
slug: kachel-kuerzel-veralteter-zustand
status: done
severity: S3
area: pwa
instance: dev
commit: "21706d8"
forge: "https://gitlab.com/SiLenT_Tz/mobile-hub/-/work_items/26"
epic: "P18"
created: 2026-10-27
reporter: claude
---

# BUG-0071 — Zwei Kachel-Kürzel kurz hintereinander: das zweite arbeitet auf dem Zustand vor dem ersten

## Gesehen

Alt+1 und direkt danach Alt+Shift+2 (Kachel 1 fokussieren, dann mit Kachel 2 tauschen): der Tausch passiert nicht. Im vollen
E2E-Lauf bei Load Average 12 schlug der Spec „Tastatur: Layout wechseln, Fokus, Tauschen, Leeren“ in 1 von 21 Wiederholungen fehl
(erwartet „Aufgabe Rechts“ in Kachel 1, war „Aufgabe Links“).

## Erwartet

Mehrere Kürzel in kurzer Folge wirken nacheinander auf das jeweilige Ergebnis, auch wenn Preact dazwischen noch nicht gerendert hat.

## Repro

Voraussetzung: Desktop-Workspace (≥ 1280 px) mit zwei Kacheln, Fokus auf Kachel 2.

1. Beide Tastendrücke im selben Tick senden (genau das, was ein schneller Tipper oder eine ausgelastete Maschine erzeugt):
   `window.dispatchEvent(new KeyboardEvent("keydown", { code: "Digit1", altKey: true }))` und gleich danach
   `… { code: "Digit2", altKey: true, shiftKey: true }`.

**Ergebnis nach Schritt 1:** Kachel 1 zeigt weiter „Aufgabe Links“. Der Tausch war ein No-Op, weil der zweite Handler noch den Fokus 1
(von vor dem ersten Kürzel) sah und `swapWith(ws, 1)` bei `index === focus` nichts tut.

**Häufigkeit:** deterministisch bei gleichem Tick, sonst selten (1/21 unter hoher Last). Repro-Weg: PWA (Browser, E2E).

## Umgebung

| Feld | Wert |
|---|---|
| Commit | `21706d8` |
| Node-Version | v26.7.0 |
| Repro-Weg | PWA (Playwright, Chromium 155) |

## Logs

```text
[mobile] › workspace-tiles.spec.ts:43 › Tastatur: Layout wechseln, Fokus, Tauschen, Leeren
  Expected: "Aufgabe Rechts"   Received: "Aufgabe Links"   (24 × locator resolved, 10 s)
Wiederholung: 21 Läufe, 1 Fehlschlag, Load Average 12,14
```

## Tests

| Ring | Befehl / Datei | Stand vor dem Fix |
|---|---|---|
| E2E | `e2e/specs/workspace-tiles.spec.ts` „zwei Kürzel im selben Tick arbeiten auf dem Ergebnis des ersten (BUG-0071)“ | ohne Fix rot, mit Fix grün (24/24 mit `--repeat-each=3`) |

## Eingrenzung

`apps/pwa/src/features/workspace/TileWorkspace.tsx`: der `keydown`-Handler schloss über das `ws` seines letzten Renders. Fix: eine
Referenz auf den neuesten Zustand, der Handler liest und schreibt sie sofort.

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [x] GitLab-Issue angelegt (Link oben)
- [x] `bugfix` erledigt
