---
id: BUG-0072
slug: hub-oom-resync-schleife
status: in-progress
severity: S1
area: core, server, pwa
instance: dev
commit: ""
forge: ""
epic: ""
created: 2026-10-27
reporter: claude
---

# BUG-0072 — Hub stürzt alle ~2 Minuten mit Heap-OOM ab (Resync-Schleife)

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
- PWA `ws.ts`/`ws-protocol.ts`: pro `lastSeq` höchstens ein `resync`, ein nicht schließender Resync wird nicht wiederholt.

## Tests

- `packages/core/test/platform/eventstore.test.ts`: Aufrufreihenfolge mit Blob (scheitert ohne Fix), unsortierter Altbestand (scheitert ohne Fix), Paging/Limit/Torn-Line.
- `apps/pwa/test/shared/ws-protocol.test.ts`: kein wiederholter Resync.

## Verifikation

Hub nach dem Fix 8+ Minuten bei ~215 MB RSS, 0 Neustarts, 0 OOM. Provider-Smoke (9 Adapter) grün bis auf Aider (kein Modell konfiguriert). `npm test` 911 grün, Lint und Typecheck grün, E2E 203 grün (1 Spec flaky unter Volllast, einzeln grün).
