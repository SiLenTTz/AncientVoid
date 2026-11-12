---
id: BUG-0142
slug: e2e-fenster-schliessen-rennen
status: done
severity: S3
area: e2e
instance: dev
commit: "b1bf57b"
forge: ""
epic: "EPIC-P43 T43.7"
created: 2026-11-12
reporter: "Claude — volle E2E-Suite auf main"
---

# BUG-0142 — „In die App zurück“ wird unter Last als „Target closed“ rot

## Gesehen

`herausloesen.spec.ts` „jede Ansicht … kommt heim“ rot in der vollen Suite: `locator.click: Target page, context or browser has been closed`. Einzeln 4/4 grün.

## Erwartet

Ein Klick, der sein eigenes Fenster schließt, gilt als erfolgreich, sobald das Fenster zu ist.

## Eingrenzung

Die Taste ruft `window.close()`; unter Last schließt das Fenster, bevor Playwright den Klick quittiert. Test-Rennen, kein Produktfehler. Gleiches Muster zweimal in `windows.spec.ts`.

## Fix

Helfer `clickClosing` (`e2e/support/fixtures.ts`): Klickfehler zählt nur, wenn das Fenster danach nicht geschlossen ist; auf `close` wird weiter gewartet.

## Tests

| Ring | Datei | vor dem Fix |
|---|---|---|
| E2E | `herausloesen`, `windows` (`--repeat-each=3`, 6 Worker) | flaky in voller Suite |
