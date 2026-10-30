# BUG-0082 — Benachrichtigungs-Panel ragt bei UI-Skalierung aus dem Bildschirm

- **Gemeldet:** 2026-10-30, Nutzer (Handy, UI-Skalierung aktiv) — „das
  notifications modal ragt rechts aus dem Bildschirm Rand heraus“
- **Status:** gefixt
- **Komponente:** PWA-Styles `14-notifications.css`, `18-commands.css`

## Beobachtet

Mit UI-Skalierung > 100 % (CSS `zoom` auf `<html>`, EPIC-P20 T20.2) wird das
Benachrichtigungs-Panel breiter als der Bildschirm und lässt sich nicht mehr
ordinär schließen.

Live vermessen (Playwright, 390-px-Viewport, Skalierung 1.4): Panel gerendert
**523 px** statt ≤ 374 px — ragt links 145 px und rechts 11 px heraus; der
✕-Knopf im Panel-Kopf lag außerhalb des Viewports (nicht klickbar).

## Root-cause

`14-notifications.css` (`\.notif-bell`, `.notif-gear`, `.notif-panel`) und
`18-commands.css` (`.command-sheet`) rechnen Breiten/Rechts-Abstände mit
`100vw` **ohne** Division durch `--ui-zoom`. `zoom` skaliert die gerenderte
Größe, `vw` bleibt unskaliert — Höhen werden überall geteilt
(`02-layout.css`: `calc(100dvh / var(--ui-zoom, 1))`), Breiten nicht:
`min(380px, 100vw - 16px)` × 1,4 = 523 px.

## Fix

`100vw` an allen fünf Stellen durch `calc(100vw / var(--ui-zoom, 1))` ersetzt
— dasselbe Muster wie bei den Höhen. Bei Skalierung 100 % unverändert
(Divisor 1).

## Test

- E2E `notifications.spec.ts` „das Panel bleibt bei 140 % Skalierung im
  Bildschirm und die ✕ bleibt erreichbar“ (Telefon-Viewport 390 px):
  Panel- und Knopf-Box komplett im Viewport — rot ohne Fix, grün mit Fix.
- Gates: typecheck, lint, npm test (167 Dateien), test:e2e 276 passed /
  2 skipped / 0 failed.
