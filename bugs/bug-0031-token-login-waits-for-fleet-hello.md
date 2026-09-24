---
id: BUG-0031
slug: token-login-waits-for-fleet-hello
status: in-progress
severity: S3
area: pwa
instance: dev
commit: ""
forge: "https://gitlab.com/SiLenT_Tz/mobile-hub/-/work_items/12"
epic: P12
created: 2026-09-25
reporter: Codex
---

# BUG-0031 — Token-Login wartet auf Fleet-Handshake

## Gesehen

Nach erfolgreicher Token-Prüfung bleibt „Verbinden“ sichtbar, solange der
separate Fleet-Handshake `/api/fleet/hello` nicht antwortet.

## Erwartet

Nach dem erfolgreichen, token-geschützten `/api/adapters`-Aufruf verschwindet
die Tokenmaske; Fleet-Erkennung läuft im Hintergrund weiter.

## Repro

Voraussetzung: lokaler E2E-Hub, PWA im Browser, gültiges zweites Gerätetoken.

1. PWA öffnen, zu Einstellungen gehen und „Geräte-Token wechseln“ wählen.
2. Ein gültiges anderes Gerätetoken eingeben.
3. Im Browser `/api/fleet/hello` anhalten und „Verbinden“ drücken.
4. `/api/adapters` antwortet mit HTTP 200, Fleet-Antwort bleibt aus.

**Ergebnis nach Schritt 4:** „Verbinden“ bleibt sichtbar, obwohl das Token
bereits akzeptiert wurde.

**Häufigkeit:** deterministisch mit verzögertem Fleet-Handshake. Im vorherigen
P12-Gate-Lauf trat die reale Variante beim Draft-Test einmal auf drei Läufe auf.

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | isolierter lokaler E2E-Hub |
| Commit | `ce156ff` (Ausgangspunkt des Fix-Branches) |
| Node-Version | 26.7 |
| Adapter | opencode fixture |
| Repro-Weg | Playwright/PWA |

## Logs

Playwright-Probe vor dem Fix: `npx playwright test e2e/specs/drafts.spec.ts --grep 'AC-P8-4' --project=mobile`.
Der geschützte `/api/adapters`-Aufruf kam mit HTTP 200 zurück; bei blockiertem
`/api/fleet/hello` schlug die 2-s-Erwartung auf Verschwinden des Buttons fehl.
Keine Secrets oder Tokens im Bericht.

## Tests

| Ring | Befehl / Datei | Stand vor dem Fix |
|---|---|---|
| E2E | `e2e/specs/drafts.spec.ts` / AC-P8-4 | vorhandener Test flaky; verzögerter Fleet-Handshake reproduziert das Warten |

Die ergänzte AC-P8-4-E2E-Probe hält den Handshake an; sie schlägt ohne den Fix
fehl und besteht damit.

## Eingrenzung

`apps/pwa/src/app/main.tsx`: `becomeReady()` setzt `ready` erst nach dem
`/api/fleet/hello`-Aufruf. Dieser Discovery-Aufruf ist unabhängig davon, ob
`/api/adapters` den Geräte-Token bereits bestätigt hat.

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [x] GitLab-Issue angelegt
- [x] `bugfix` läuft
