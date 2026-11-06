---
id: BUG-0098
slug: dock-buttons-abgeschnitten
status: done
severity: S2
area: pwa
instance: live (Nutzerbericht 06.11.2026)
commit: "5064db39"
epic: ""
created: 2026-11-06
reporter: "Nutzer"
---

# BUG-0098 — Fixierter Dock schneidet Buttons ab, wenn er höher als der Screen wird

## Gesehen (Nutzerbericht 06.11.2026)

„Außerdem sind die Buttons ab und zu überdeckt. Diese sollten immer gut
sichtbar und nicht abgeschnitten sein." — Session mit voller Steuerung
(Konfiguration offen, mehrere vorgemerkte Nachrichten, Vorlagen, Eingabe)
auf kleinem Bildschirm: `.dock-stack` ist `position: fixed; bottom: 0`
**ohne Höhenbegrenzung** — sein Inhalt schob den Dock über den oberen
Bildschirmrand; die obersten Elemente (Ein-/Ausklapp-Knopf, Konfiguration,
Warteschlange) waren abgeschnitten und nicht mehr bedienbar. Messung:
`dock.top = -12 px` bei 350 px Viewport.

## Erwartet

Jeder Button im Dock ist sichtbar und erreichbar — der Dock scrollt selbst,
statt aus dem Bild zu laufen.

## Repro

E2E `dock-visibility.spec.ts` (mobile, Viewport 412×350, Steuerung
ausgeklappt, fünf vorgemerkte Nachrichten): `dock.top >= 0`,
`dock.height <= viewport`, Ein-/Ausklapp-Knopf sichtbar. Ohne Fix rot
(dock.top = −12), mit Fix grün (dock.top = 0, Dock scrollt intern).

## Ursache

`apps/pwa/src/app/styles/10-voice-and-dock.css` — `.dock-stack` hatte keine
`max-height`: `position: fixed; bottom: 0` wächst nach oben aus dem
Viewport hinaus, sobald der Inhalt höher als der Bildschirm ist.

## Fix

`max-height: calc(100dvh / var(--ui-zoom, 1))` (wie `.split`,
EPIC-P20-Zoom berücksichtigt) und `overflow-y: auto` — der Dock bleibt
innerhalb des Screens und scrollt bei Überhöhe selbst. Die Tail-Messung
(ResizeObserver auf den Dock) passt sich automatisch an.

## Nachweis

Siehe MR.
