---
id: BUG-0053
slug: dock-im-querformat-zu-hoch
status: done
severity: S2
area: pwa
instance: prod
commit: ""
forge: ""
epic: "P1.6"
created: 2026-10-09
reporter: jan
---

# BUG-0053 — Im Querformat füllt das Dock fast den Bildschirm, der Verlauf ragt darunter

## Gesehen

Gemessen am echten Pixel 9 Pro XL (adb + Chrome, Querformat: 997×368 CSS-Pixel): Das Dock der
Session-Ansicht ist 327 px hoch (Modus/Modell, Antwortvorlagen, Eingabefeld, vier Knöpfe, Filterchips,
Tabs). Dem Verlauf bleiben **120 von 368 px**. Die Höhenberechnung der App ging außerdem nie unter
120 px, obwohl nur 53 px frei waren — der Verlauf **ragte 59 px unter das Dock**, die letzten
Nachrichten waren verdeckt. Zusammen mit der 137 px hohen Kopfzeile (Fortschritt, Kontingent, Tokens)
blieb kaum Platz zum Lesen.

## Erwartet

In einem niedrigen Fenster bleibt dem Verlauf mindestens ein Drittel der Höhe, und er liegt nie
unter dem Dock. Im Hochformat bleibt alles wie es war.

## Repro

1. Session am Handy (oder im Browser mit 900×420) öffnen.
2. Dock und Verlauf messen.

**Ergebnis nach Schritt 2:** Verlauf 120 px, Dock 222–327 px, Überlappung.

**Häufigkeit:** immer im Querformat.

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | Pixel 9 Pro XL, Chrome 154, Querformat |
| Commit | `e5a7130`-Linie |
| Repro-Weg | E2E auf dem Handy und im Playwright-Browser (900×420) |

## Logs

```text
{"inner":368,"vv":368,"dock":[41,368],"tail":[137,257]}      (Handy, Querformat)
{"height":420,"tail":120,"dock":222,"tailBottom":257,"dockTop":198}  (Test, Dock schon verkleinert: Überlappung 59 px)
```

## Tests

| Ring | Befehl / Datei | Stand vor dem Fix |
|---|---|---|
| E2E | `e2e/specs/querformat.spec.ts` (3) | „mindestens ein Drittel“ rot ohne Fix (120 < 140) |

## Eingrenzung

`SessionTail.tsx` (`tailMaxHeight` mit Untergrenze 120; Steuerung immer eingeblendet),
`08-session-events.css`. Fix: unter 520 px Fensterhöhe startet die Steuerung eingeklappt (eine
bewusste Wahl wird weiter gemerkt), Vorlagen, Filterchips, Statuszeilen und die Fortschrittszeile
entfallen, Eingabe und Tabs werden kompakter; die Untergrenze der Höhe sinkt auf 48 px.

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [x] Fix in derselben MR
