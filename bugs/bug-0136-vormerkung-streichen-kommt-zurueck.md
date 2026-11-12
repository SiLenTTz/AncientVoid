---
id: BUG-0136
slug: vormerkung-streichen-kommt-zurueck
status: done
severity: S2
area: pwa
instance: dev
commit: "ce19ab6"
forge: ""
epic: "EPIC-P15 T15.3"
created: 2026-11-12
reporter: "Jan (Nutzermeldung)"
---

# BUG-0136 — Gestrichene vorgemerkte Nachricht ist nach dem Neuladen wieder da

## Gesehen

„✕“ an einer vorgemerkten Nachricht blendet sie aus; nach einem Refresh steht sie wieder in der Liste und geht am Zugende trotzdem raus.

## Erwartet

Gestrichen heißt beim Hub gestrichen. Scheitert das Streichen, bleibt der Eintrag sichtbar und die PWA sagt es.

## Repro

1. Session mit laufendem Zug öffnen, Nachricht vormerken.
2. „Vorgemerkte Nachricht 1 streichen“ klicken — der Eintrag verschwindet.
3. Seite neu laden.

**Ergebnis nach Schritt 3:** Der Eintrag ist wieder da.

**Häufigkeit:** immer (in keinem echten Session-Log gibt es ein einziges `session.unqueued`).

## Umgebung

| Feld | Wert |
|---|---|
| Instanz | lokal |
| Commit | `ce19ab6` |
| Repro-Weg | PWA, Hub-Route-Test |

## Eingrenzung

- `apps/pwa/src/shared/api.ts` `api()` setzte `content-type: application/json` auch ohne Body;
  Fastify antwortet auf `DELETE /api/sessions/:id/queue/:queueId` mit leerem JSON-Body 400
  (`FST_ERR_CTP_EMPTY_JSON_BODY`) — dieselbe Fehlerklasse wie BUG-0011/BUG-0115.
- `apps/pwa/src/features/session/QueueList.tsx` entfernte optimistisch und verschluckte den Fehler.

## Fix

- Client: Content-Type nur mit Body.
- Hub (`apps/hub/src/app.ts`): leerer JSON-Body = kein Body statt 400 — schützt jeden Client.
- QueueList: Fehlschlag stellt den Eintrag zurück und meldet es (404 = schon weg, kein Fehler).

## Tests

| Ring | Datei | vor dem Fix |
|---|---|---|
| Integration | `apps/hub/test/modules/sessions/queue.test.ts` (DELETE mit JSON-Content-Type ohne Body) | rot (400) |
| E2E | `e2e/specs/pause-queue.spec.ts` (Hub-Warteschlange leer, nach Reload leer) | grün trotz Bug (prüfte nur das Ausblenden) |
