# EPIC-P23 — Desktop-Navigation, Reste: „AncientVoid“ = Übersicht, einheitliche Statusleiste

**Status:** Code abgeschlossen 2026-10-28 · **Phase:** P23 · **Abhängigkeit:** P18 (Kacheln), P20, P21 T21.1 (Icon-Leisten, bereits gemergt)

Auslöser: Wunsch von Jan vom 2026-10-27 („Icon-Buttons als Seitenmenü, einheitliche Statusleiste, Klick auf AncientVoid führt immer in die Übersicht,
mit der zuletzt aktiven Session ausgewählt“). Die Icon-Leisten kamen mit P21 T21.1 auf main. Ein früherer, parallel entstandener Branch
(`feat/p21-desktop-navigation`, Nummernkonflikt mit P21) hatte dieselben Leisten anders gebaut und zwei Dinge zusätzlich: diese beiden.
Sie sind hier neu auf dem Stand von main gebaut, der alte Branch ist damit überholt.

## 1. Ziel
Ab 1280 px steht unten eine Statusleiste für alles, was für den ganzen Hub gilt; „AncientVoid“ führt von überall in die Übersicht, und die zuletzt benutzte
Session ist dort markiert. Handy unverändert. Messlatten: K2 (keine zusätzliche Last), K10 (Verbindungsverlust sichtbar, Zeit des letzten Standes).

## 2. Scope (In / Out)
**In:** T23.1 „AncientVoid“-Knopf + Merker der letzten Session (pro Gerät, `localStorage`), Markierung/`aria-current` in der Übersicht; T23.2 Statusleiste
(Verbindung, Flotte, Sessions nach Zustand, offene Freigaben klickbar, fokussierte Kachel, Uhrzeit).
**Out:** neue Seiten, anpassbare Leisten, Handy-Navigation, Serveränderungen, Kennzahlen (Tokens/Kontext) der Kachel in der Leiste (bleiben in der Kachel).

## 3. Aufgaben
- [x] **T23.1** `features/shell/last-session.ts`; gemerkt beim Öffnen, Kachelfokus und Deep-Link; `Dashboard` markiert und scrollt einmal pro Besuch ins Bild. `shell.test.ts`, `navigation-desktop.spec.ts`.
- [x] **T23.2** `features/shell/{hub-status,status-summary,StatusBar}`: `App` veröffentlicht seine 3-s-Abfrage, die Leiste rendert höchstens 1× pro Sekunde, keine zweite Abfrage. `shell.test.ts`, `navigation-desktop.spec.ts`.

## 4. Akzeptanzkriterien
- AC-P23-1: „AncientVoid“ öffnet die Übersicht von jeder Seite; die zuletzt aktive Session trägt `aria-current`, auch nach Reload. Beleg: `navigation-desktop.spec.ts`.
- AC-P23-2: Die Statusleiste zeigt Verbindung, Flotte, Zähler und die fokussierte Session, sitzt unten über die ganze Breite, das Fenster scrollt nie. Beleg: `navigation-desktop.spec.ts`.
- AC-P23-3: Unter 1280 px gibt es keine Statusleiste, das Dock bleibt. Beleg: `navigation-desktop.spec.ts`.
- AC-P23-4 (K10): Bei Verbindungsverlust steht „keine Verbindung · Stand <Uhrzeit>“. Beleg: Einheitentest `clockText`/`StatusBar`; **E2E-Beleg offen** (Hub-Ausfall im Spec nicht simuliert).

## 5. Premortem
1. **Zweite Abfrage für dieselben Daten.** Nicht eingetreten: `publishHubStatus` aus `App`.
2. **Bestehende Specs finden die Überschrift nicht mehr.** Eingetreten (aria-label veränderte den Namen von „AncientVoid“), behoben: der Knopf behält den sichtbaren Namen.
3. **Fenster scrollt wegen der Leiste.** Nicht eingetreten: `.split` ist 28 px niedriger, Spec prüft `scrollHeight`.

## 6. Definition of Done
`npm run gate` grün, Specs je Funktion, Hub neu gestartet. Offen: AC-P23-4 E2E, Roll-out (macht Jan).
