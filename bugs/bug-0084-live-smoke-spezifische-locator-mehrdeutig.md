---
id: BUG-0084
slug: live-smoke-spezifische-locator-mehrdeutig
status: done
severity: S3
area: e2e
instance: live (Hub 127.0.0.1:7373)
commit: ""
epic: ""
created: 2026-11-01
reporter: "Dev (Live-Smoke)"
---

# BUG-0084 — Live-Smoke-Spec: mehrdeutige Locator gegen den bevölkerten Live-Hub

- **Gefunden:** 2026-11-01, Live-Smoke nach BUG-0083-Restart (`scripts/test-live.sh`)
- **Status:** gefixt (2026-11-07, Live-Smoke 6/6 grün gegen den echten Hub)
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
- [x] `bugfix`, sobald dafür Zeit ist (kleiner Locator-Fix, kein Produktionscode)

## Fix (2026-11-07)

Beide Locator im Live-Smoke eindeutig gemacht — kein Produktionscode geändert:

1. `Status` → `getByRole("button", { name: "Status", exact: true })`:
   Der Header-Link trägt den Text „Status“ (der title „Provider-Status“ wird
   vom Text-Inhalt überstimmt); `exact` schließt „Gate-Status prüfen und
   Stand“ aus.
2. `Einstellungen` → `page.locator(".dock").getByRole("button", { name:
   "Einstellungen" })`: Das Benachrichtigungs-⚙ (`Notifications.tsx:175`)
   trägt dasselbe aria-label wie der Dock-Knopf — Scope auf die globale
   Navigation statt ganze Seite.

Verifikation: `scripts/test-live.sh http://127.0.0.1:7373` gegen den
bevölkerten Live-Hub — vor dem Fix 1 failed (strict-mode, wie gemeldet),
nach dem Fix 6/6 bestanden (30,9 s). Der einmalige „Videoanalyse rot beim
Kaltstart, im Wiederholungslauf grün“-Zufallsfund trat diesmal nicht auf
und bleibt wie gemeldet dem Muster aus BUG-0077 zugeordnet.
