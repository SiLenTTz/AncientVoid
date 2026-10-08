---
id: BUG-0042
slug: invite-qr-chunk-fehler-unbehandelt
status: done
severity: S3
area: pwa
instance: dev
commit: ""
forge: ""
epic: "P6"
created: 2026-10-08
reporter: jan
---

# BUG-0042 — Einladungs-QR: fehlgeschlagener Chunk-Abruf bleibt unbehandelt und still

## Gesehen

Im E2E-Gate schlug `fleet.spec.ts` „T6.2“ einmal fehl: `Failed to fetch
dynamically imported module …/assets/qrcode-*.js` als unbehandelte Ausnahme.
`InviteQr` lädt `qrcode-generator` per `import()` ohne `.catch`. Scheitert der
Abruf (Offline, neue App-Version mit anderem Chunk-Namen), gibt es eine
unbehandelte Ausnahme und der QR-Code fehlt ohne Hinweis.

## Erwartet

Ein fehlgeschlagener Abruf wird sichtbar gemeldet (AGENTS.md Regel 6); der Code
zum Eintippen steht weiter daneben. Der Test endet nicht, bevor das QR-Bild da ist.

## Repro

1. Einstellungen, „Einladungscode erzeugen“, Abruf von `assets/qrcode-*.js` blockieren.

**Ergebnis nach Schritt 1:** unbehandelte Ausnahme, kein QR-Bild, keine Meldung.

**Häufigkeit:** immer bei Chunk-Fehler; im Gate selten (der Test endete vor dem Laden).

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | dev (Playwright) |
| Commit | `5f21168`-Linie, Vite 8 / Preact 11 |
| Repro-Weg | E2E |

## Logs

```text
Error: uncaught PWA exceptions
+ "Failed to fetch dynamically imported module: http://127.0.0.1:40403/assets/qrcode-DtWdxa9d.js"
```

## Tests

| Ring | Befehl / Datei | Stand vor dem Fix |
|---|---|---|
| E2E | `e2e/specs/fleet.spec.ts` „BUG-0042“ (Chunk per `route.abort` blockiert) | rot ohne Fix |
| E2E | „T6.2“ wartet jetzt auf `img.fleet-qr` | — |

## Eingrenzung

`apps/pwa/src/features/fleet/InviteQr.tsx`, `InviteQr`: `import()` ohne `.catch`.

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [x] Fix in derselben MR
