---
id: BUG-0011
slug: stop-button-silently-broken
status: fixed
severity: S1
area: pwa
instance: dev
commit: "1224ace"
forge: ""
epic: "EPIC-P3 (found while building T3.10)"
created: 2026-09-18
reporter: "Claude Sonnet 5 (autonomous session)"
---

# BUG-0011 — "Stop"-Button in der PWA tat real nichts

## Gesehen

`hubApi.stopSession(id)` sendet `POST /api/sessions/:id/stop` mit dem
`content-type: application/json`-Header (von `api()` unconditional
gesetzt), aber **ohne Body**. Fastifys JSON-Parser lehnt das mit einem
echten `400 FST_ERR_CTP_EMPTY_JSON_BODY` ab. `SessionTail.tsx`s
`stop()`-Handler fing diesen Fehler mit `.catch(() => undefined)` ab —
der Nutzer sah nichts: kein Fehler, keine Statusänderung, der Button tat
schlicht nichts. Real reproduziert per `curl` (siehe Repro) — keine
Vermutung.

## Erwartet

Ein Tap auf „Stop" beendet die Session real (Status → `stopped`) und
zeigt bei einem echten Fehlschlag sichtbar einen Fehler, statt still zu
bleiben.

## Repro

Voraussetzung: Hub läuft lokal, eine Session mit `dummy`-Adapter existiert.

1. `curl -s -X POST http://127.0.0.1:<port>/api/sessions/<id>/stop -H "authorization: Bearer <token>" -H "content-type: application/json"`
2. Antwort: `{"statusCode":400,"code":"FST_ERR_CTP_EMPTY_JSON_BODY", …}`.

**Ergebnis nach Schritt 2:** Session-Status bleibt unverändert (nicht
`stopped`). In der PWA: Tap auf „Stop" — keine sichtbare Reaktion.

**Häufigkeit:** immer (jeder Aufruf ohne Body + diesem Header schlägt
strukturell fehl, nicht nur manchmal).

**Gefunden während:** T3.10 (Sprach-Direktiven-Parser) — eine
Live-Playwright-Verifikation des „stopp"-Sprachbefehls rief real
dieselbe `stopSession()`-Funktion auf und bekam denselben 400 zurück,
was den Fehler erstmals sichtbar machte.

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | lokal (`127.0.0.1`, Scratch-Port) |
| Commit | `1224ace` |
| Node-Version | v26.7.0 |
| Adapter | dummy |
| Repro-Weg | curl direkt gegen die Route + Playwright gegen die echte PWA |

## Logs

```text
{"statusCode":400,"code":"FST_ERR_CTP_EMPTY_JSON_BODY","error":"Bad Request",
 "message":"Body cannot be empty when content-type is set to 'application/json'"}
```

## Tests

| Ring | Befehl / Datei | Stand vor dem Fix |
|---|---|---|
| Unit | keiner vorhanden für `hubApi.stopSession` (PWA hat keine Unit-Test-Infrastruktur für API-Client-Funktionen, nur Playwright-Live-Checks) | nicht vorhanden |
| Live (Playwright) | T3.10s Sprachbefehl-Verifikation (`/tmp/…/check-t310-voice.mjs`, nicht Teil des Repos) | rot vor dem Fix (Session blieb `working` statt `stopped`), grün danach |

Kein automatisierter Regressionstest im Repo selbst — dieselbe
Repo-Konvention wie bei anderen PWA-Fixes dieser Session (T1.6-9s
Service-Worker-Fix, T2.5s leerer-Body-Fix): PWA-Netzwerkfunktionen werden
über Live-Checks verifiziert, nicht über Unit-Tests des API-Clients.

## Eingrenzung

`packages/pwa/src/api.ts:267-268` (`stopSession`), Symptom sichtbar in
`packages/pwa/src/SessionTail.tsx:237-239` (`stop()`-Handler, das
Verschlucken des Fehlers).

## Handoff

- [x] Datei im Index [`README.md`](README.md)
- [ ] GitLab-Issue angelegt (GitLab derzeit nicht erreichbar — Gitaly-Ausfall, siehe Session-Historie)
- [x] Behoben im selben Commit, der diese Datei einführt: `stopSession()` sendet jetzt `body: "{}"`;
      `SessionTail.tsx`s `stop()` surfaced einen echten Fehlschlag jetzt sichtbar statt ihn zu verschlucken.
