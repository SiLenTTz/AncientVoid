---
id: BUG-0075
slug: hub-oom-resync-schleife
status: done
severity: S1
area: core, server, pwa
instance: dev
commit: ""
forge: "MR !219, !225, !229"
epic: ""
created: 2026-10-27
reporter: claude
---

# BUG-0075 — Hub stürzt alle ~2 Minuten mit Heap-OOM ab (Resync-Schleife)

## Gesehen

`uacc-hub.service` lief in eine Absturzschleife (`JavaScript heap out of memory`, 166 Node-Reports am 2026-10-27, davor 79 Neustarts). Sessions brachen dadurch dauernd ab.

## Erwartet

Der Hub bleibt bei einigen hundert MB und bedient offene Tabs ohne Neustart.

## Ursache (belegt per Heap-Sampling und Debug-Log)

1. `EventStore.append()` legte große Payloads (> 4 KB, K5) per `await writeBlob` **vor** der Append-Kette ab. Ein Event mit großem Tool-Result überholte seine kleineren Nachfolger und stand mit niedrigerer `seq` hinter ihnen in `events.jsonl` (z. B. 405, 407, 408, 406; 36 Stellen in einer Session).
2. Die PWA sieht beim `hello` das erste Event 407 bei `lastSeq=405`, hält das für eine Lücke und sendet `resync since=405`. Die Antwort enthält wieder 407 zuerst, sie sendet wieder `resync`. Ergebnis: ~2 700 `resync` in 12 s auf einer einzigen Verbindung.
3. Jeder `resync` rief `tail()`, das die ganze Datei parste und zod-validierte (O(Datei), alles im Speicher). Mehrere solcher Aufrufe parallel plus der unbeschränkte readline-Puffer füllten den 4-GB-Heap in Sekunden.

## Fix

- `EventStore.append()`: Blob-Offload und Schreiben laufen gemeinsam in der Kette (Aufrufreihenfolge bleibt auf der Platte erhalten).
- `EventStore.tail()`: streamt, überspringt alte Zeilen vor JSON/zod, bricht nach `limit` (+Slack) ab, liefert nach `seq` sortiert (Altbestand bleibt lesbar).
- Hub `ws.ts`: ein `resync` während eines laufenden Replays wird verworfen.
- PWA `ws.ts`/`ws-protocol.ts`: `resync` mit Backoff (0/250/750/2000/5000 ms) und höchstens 5 Versuchen je Lücke.
  Die erste Fassung („nur ein resync“) war falsch: eine Lücke ist oft nur ein Event, das beim ersten Lesen noch nicht auf der Platte stand — der Client verlor dann das erste Event dauerhaft (E2E `session.spec`/`attachments.spec` ~1 von 3 Läufen rot, 0 von 260 vorher). Bisektiert auf den Fix-Commit, behoben, 208/208 Läufe grün.

## Tests

- `packages/core/test/platform/eventstore.test.ts`: Aufrufreihenfolge mit Blob (scheitert ohne Fix), unsortierter Altbestand (scheitert ohne Fix), Paging/Limit/Torn-Line.
- `apps/pwa/test/shared/ws-protocol.test.ts`: kein wiederholter Resync.

## Verifikation

Hub nach dem Fix 8+ Minuten bei ~215 MB RSS, 0 Neustarts, 0 OOM. Provider-Smoke (9 Adapter) grün bis auf Aider (kein Modell konfiguriert). `npm test` 911 grün, Lint und Typecheck grün, E2E 203 grün (1 Spec flaky unter Volllast, einzeln grün).

## Nummer

Dieser Bug hieß kurz BUG-0072 (in den Commit-Texten von !219, !225 und !229 so zu lesen) und wurde am 2026-10-28 auf **BUG-0075** umnummeriert,
weil die parallel entstandene MR !218 die Nummern 0072 bis 0074 belegt. Dort beschreibt BUG-0074 denselben Absturz als Symptom mit „Ursache offen“:
Ursache und Fix stehen hier. Nach dem Merge von !218 gehört BUG-0074 auf `done` mit Verweis auf BUG-0075.

## Nachtrag: Frühwarnung

Heap-Wächter (`checks.memory` in `/api/health`, Stufenwechsel im Log), damit ein künftiges Leck vor dem OOM auffällt: MR !229.
