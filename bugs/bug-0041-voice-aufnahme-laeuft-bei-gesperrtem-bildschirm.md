---
id: BUG-0041
slug: voice-aufnahme-laeuft-bei-gesperrtem-bildschirm
status: done
severity: S3
area: pwa
instance: dev
commit: ""
forge: ""
epic: "P10"
created: 2026-10-08
reporter: jan
---

# BUG-0041 — Voice-Aufnahme läuft weiter, wenn der Bildschirm schon gesperrt ist

## Gesehen

Das E2E-Gate schlug im Volllauf einmal bei „Gesperrter Bildschirm bricht die
Aufnahme sichtbar ab (AC-P10-5)" fehl (`voice-local.spec.ts:98`), im Einzellauf
nie. Ursache: Der `visibilitychange`-Listener wird erst im `useEffect` nach dem
Rendern von `recording=true` registriert. Ein Sperren zwischen Render und Effect —
oder davor, etwa während des Mikrofon-Dialogs — wird nie ausgewertet; die
Aufnahme läuft weiter.

## Erwartet

AC-P10-5: Ein gesperrter Bildschirm beendet die Aufnahme sichtbar, auch wenn er
schon vor dem Start des Listeners gesperrt war.

## Repro

1. Session öffnen; `document.visibilityState` auf `hidden` setzen, ohne Event.
2. „Voice" tippen.

**Ergebnis nach Schritt 2:** Aufnahme läuft, keine Abbruchmeldung.

**Häufigkeit:** deterministisch im Repro; im Volllauf des Gates selten (Timing).

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | dev (Playwright, mobile) |
| Commit | `c6d7c01` |
| Repro-Weg | PWA / E2E |

## Logs

```text
Expect "toBeVisible" getByText(/Aufnahme abgebrochen — Bildschirm gesperrt/)
Error: element(s) not found (Timeout 10000ms)
```

## Tests

| Ring | Befehl / Datei | Stand vor dem Fix |
|---|---|---|
| E2E | `e2e/specs/voice-local.spec.ts` „Schon gesperrter Bildschirm … (BUG-0041)" | rot ohne Fix |

## Eingrenzung

`apps/pwa/src/features/composer/Composer.tsx`, Effect „AC-P10-5": nach dem
Registrieren des Listeners fehlte die Prüfung des aktuellen Zustands.

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [x] Fix in derselben MR
