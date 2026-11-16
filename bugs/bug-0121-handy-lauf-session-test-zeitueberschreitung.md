---
id: BUG-0121
slug: handy-lauf-session-test-zeitueberschreitung
status: open
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

Offen. Kandidaten: Tabs, die vorherige Tests in Chrome am Handy hinterlassen (Speicher/Drosselung), oder die Dauer der
Schritte vor Zeile 23 auf dem Gerät. Ein Trace (`--trace on`) im Gesamtlauf grenzt es ein.

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [ ] GitLab-Issue angelegt (Link oben)
- [ ] `bugfix` oder offen lassen
