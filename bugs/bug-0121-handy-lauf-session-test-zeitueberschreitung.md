---
id: BUG-0121
slug: handy-lauf-session-test-zeitueberschreitung
status: done
severity: S3
area: e2e
instance: dev
commit: "492999d"
forge: "https://github.com/SiLenTTz/AncientVoid/issues/3"
epic: "EPIC-P43"
created: 2026-11-11
reporter: "Agent (EPIC-P43 T43.9)"
---

# BUG-0121 — Am echten Handy läuft „neue Session aus der UI“ in der Gesamtfolge in die Zeitüberschreitung

## Gesehen

Im vollen `npm run test:phone` (OnePlus A6013) scheitert `session.spec.ts:4` als Test 55 von 109 nach 45 s; die Seite ist
beim Warten auf „Antwort auf: Fasse die README zusammen …“ im Chat schon geschlossen. 2 von 2 Gesamtläufen am 2026-11-11.

## Erwartet

Der Test ist in der Gesamtfolge so grün wie einzeln.

## Repro

Voraussetzung: Handy per adb verbunden, entsperrt.

1. `npm run test:phone`
2. Ergebnis von `session.spec.ts:4` ansehen.

**Ergebnis nach Schritt 2:** Zeitüberschreitung (45 s). Einzeln (`npm run test:phone -- session.spec.ts:4`, 6,9 s) und
`session.spec.ts --repeat-each=2` (42 von 42) grün.

**Häufigkeit:** immer in der Gesamtfolge, nie einzeln (bisher 2 bzw. 3 Läufe).

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | lokal, E2E-Hub |
| Commit | `492999d` |
| Node-Version | 26.7.0 |
| Adapter | opencode-Attrappe |
| Repro-Weg | `npm run test:phone` |

## Logs

```text
Error: expect(locator).toBeVisible() failed
Locator: locator('.tail-scroll').getByText(/Antwort auf: Fasse die README zusammen · Session ses_e2e_/)
Error: Target page, context or browser has been closed
```

## Tests

| Ring | Befehl / Datei | Stand vor dem Fix |
|---|---|---|
| E2E (Handy) | `npm run test:phone` | rot in der Gesamtfolge |

## Eingrenzung

Aufgelöst 16.11.2026 — **Speicherdruck auf dem Gerät**, genau der ursprüngliche
Kandidat (Tabs/Hintergrund-Apps). Beleg am selben A6013: Mit ~0,5 GB freiem
RAM brach die Gesamtfolge in 14 reine Timeouts zusammen („page closed“,
Android warf Chrome-Tabs weg, Suite brach bei Test 18 ab); nach
`am force-stop com.android.chrome` + `am kill-all` (~1,3 GB frei) lief die
**Gesamtfolge 107/107 grün (16,4 min)** — inklusive `session.spec.ts:4`
(Test 57, 6,6 s), des ursprünglichen Zeitüberschreitungs-Falls.

## Fix

`scripts/phone-e2e.mjs` räumt vor dem Lauf auf: Chrome per `force-stop`
neu starten und Hintergrundaktivitäten per `am kill-all` leeren —
deterministische Startbedingungen statt zufällig belegtem RAM. Kein
Produktcode; der Zeuge sind die beiden Läufe oben.

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [x] Issue angelegt (GitHub #3, Nach-GitLab-Umzug)
- [x] `bugfix` (16.11.2026, siehe Fix)
