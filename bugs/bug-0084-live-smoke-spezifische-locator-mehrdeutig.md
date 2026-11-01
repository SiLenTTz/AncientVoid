# BUG-0084 — Live-Smoke-Spec: mehrdeutige Locator gegen den bevölkerten Live-Hub

- **Gefunden:** 2026-11-01, Live-Smoke nach BUG-0083-Restart (`scripts/test-live.sh`)
- **Status:** open
- **Komponente:** `e2e/live/live.spec.ts` (nur der Live-Smoke, nicht das E2E-Gate)

## Beobachtet

2 von 6 Live-Tests scheitern deterministisch gegen den echten Hub (mit echten
Sessions und Benachrichtigungs-Zahnrad) an strict-mode violations — nicht an
Produktionscode:

1. `Übersicht, Flotte und Status laden` — `getByRole("button", { name: "Status" })`
   matcht zusätzlich den Session-Knopf „Gate-Status prüfen und Stand".
2. `Einstellungen zeigen den Gemini-Schlüssel nie` — `getByRole("button", { name: "Einstellungen" })`
   matcht zusätzlich das Benachrichtigungs-⚙ (`notif-gear`, BUG-0082-Umfeld).

Daneben einmalig: `Videoanalyse` direkt nach Kaltstart des Hubs rot, im
Wiederholungslauf grün (Race beim Medien-Pipeline-Hochfahren — analog zum
Muster aus BUG-0077, nicht reproduziert).

## Erwartet

Der Live-Smoke läuft gegen den echten, bevölkerten Hub grün — Locator via
`{ exact: true }` oder eindeutiger Rolle/Container auflösen.

## Repro

```bash
scripts/test-live.sh   # gegen den laufenden Hub (Port 7373)
```

## Eingrenzung

`e2e/live/live.spec.ts:27` und `:52`. Kein Zusammenhang mit BUG-0083 (dessen
Live-Verifikation — Formular reagiert, Provider/Modell wählbar — ist grün).

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [ ] `bugfix`, sobald dafür Zeit ist (kleiner Locator-Fix, kein Produktionscode)
