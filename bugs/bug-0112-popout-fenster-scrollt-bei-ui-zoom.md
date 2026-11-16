---
id: BUG-0112
slug: popout-fenster-scrollt-bei-ui-zoom
status: done
area: pwa
instance: live (Nutzerbericht 10.11.2026, installierte Omarchy-Web-App)
commit: "2d44bc8"
epic: "P50"
created: 2026-11-10
reporter: "Nutzer"
---

# BUG-0112 — Eigenes Fenster (Chat) scrollt als ganze Seite bei UI-Zoom

## Gesehen

Nutzerbericht 10.11.2026: „Im Chat Fenster habe ich zwei scrollbars. Die
eine für die gesamte Seite dürfte nicht da sein." Das Session-Fenster
(Popout) zeigt bei UI-Zoom ≠ 100 % eine Fensterscrollbar **neben** der
Chat-Scrollbar.

Messung (Playwright, echtes Hub + dummy-Adapter, Fenster 1200×800,
`ancientvoid.uiScale` vor dem Boot gesetzt):

| uiScale | `.popout-shell` Höhe | Fenster | Seite scrollt um |
|---|---|---|---|
| 100 % | 800 px | 800 px | nein |
| 130 % | 1040 px | 800 px | **240 px** |
| 150 % | 1200 px | 800 px | **400 px** |
| 80 % | 640 px | 800 px | nein — aber 160 px Leerraum unten |

## Erwartet

Das eigene Fenster scrollt nie (wie die Übersicht seit BUG-0099): Nur der
Chat (`.tail-scroll`) bzw. der Inhaltsbereich des Fensters scrollt — bei
jedem UI-Zoom füllt die Shell exakt das Fenster.

## Repro

1. Hub starten, PWA öffnen, `ancientvoid.uiScale` auf 130 % setzen
   (Einstellungen oder Strg + „+").
2. Eine Session in einem eigenen Fenster öffnen (⧉ Kachel-Knopf oder
   Graph/Datei-Tab).
3. Nachrichten abwarten, bis der Chat scrollt.

**Ergebnis nach Schritt 3:** rechte Fensterrand zeigt zwei Balken — einen
am Fensterrand (Seite) und einen im Chat; die Fensterhoehe passt nicht.

**Häufigkeit:** immer (ab Zoom ≠ 100 %)

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | lokal / installierte Web-App |
| Commit | `2cefb78` (HEAD == origin/main, 10.11.2026) |
| Adapter | beliebig (dummy reproduziert) |
| Repro-Weg | PWA (Playwright, `/?window=1#/sessions/<id>`) |

## Logs

Keine — rein layoutseitig (CSS-Messung oben).

## Fix (10.11.2026)

`27-popout.css`: `.popout-shell` teilt die Fensterhöhe durch den Zoom —
`height: calc(100dvh / var(--ui-zoom, 1))` (Muster wie BUG-0099,
`02-layout.css`). Zusätzlich die harte Garantie aus BUG-0099 Nachtrag 2
für die Popout-Route: `html:has(.popout-shell)` und dessen `body` bekommen
`overflow: hidden` — ein eigenes Fenster scrollt nie, nur sein Inhalt
(Chat, Graph, Datei, Werkzeug) scrollt intern.

## Nachweis

E2E `windows.spec.ts` „BUG-0112: das eigene Fenster scrollt nie …"
(desktop, `uiScale=1.3` vor dem Fenster-Boot): ohne Fix rot („Seite
scrollt um 270 px"), mit Fix grün; Shell-Unterkante == Fensterhöhe.
Matrix über uiScale 80/100/130/150: Seite in keiner Stufe scrollbar, Shell
füllt exakt. Volle `windows.spec.ts` (desktop) 10/10 grün, `npm run gate`
grün.

Seit EPIC-P50 T50.4 dauerhaft gesichert durch die Zoom-Matrix
`e2e/specs/zoom-flaechen.spec.ts` (Popout bei uiScale 70/100/130/200 ×
Schrift 85/100/130); Muster in `docs/zoom-robuste-flaechen.md`.


## Tests

| Ring | Befehl / Datei | Stand vor dem Fix |
|---|---|---|
| E2E | `e2e/specs/windows.spec.ts` (Popout-Geometrie) | grün — prüft nur ohne Zoom |

Ohne Fix rot müsste: eine Popout-Geometrie-Prüfung **mit**
`ancientvoid.uiScale=1.3` (Seite nicht scrollbar, Shell-Unterkante ==
Fensterhöhe) — z. B. erweitert in `e2e/specs/windows.spec.ts`.

## Eingrenzung

`apps/pwa/src/app/styles/27-popout.css:5` — `.popout-shell` nutzt
`height: 100dvh` ohne Division durch `--ui-zoom`. Unter `html { zoom }`
(EPIC-P20) sind `dvh`-Höhen Layout-Pixel und werden beim Rendern mit dem
Zoom multipliziert; das BUG-0099-Muster (`calc(100dvh / var(--ui-zoom, 1))`,
`02-layout.css:73/:202`) fehlt hier (P34 T34.10 lief vor dem Muster).
Zusätzlich fehlt die harte Garantie „Fenster scrollt nie"
(`html:has(...) { overflow: hidden }`, BUG-0099 Nachtrag 2) für die
Popout-Route.

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [ ] GitLab-Issue angelegt
- [x] `bugfix` (Fix im selben Zug)
