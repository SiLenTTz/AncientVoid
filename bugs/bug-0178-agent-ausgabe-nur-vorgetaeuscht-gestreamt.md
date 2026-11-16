# BUG-0178 — Agent-Ausgabe wird nur vorgetäuscht gestreamt (Typewriter über fertigen Blöcken)

**Status:** in Arbeit · **Schweregrad:** S2 · **Bereich:** pwa/adapters · **Found on:**
live auf dem Handy-PWA-Pfad, nachgemessen am Event-Store einer echten pi-Session
(2026-11-16)

## Nutzerbericht

„Wie sieht das aus — nicht nach echtem Livestreaming, sondern so als wäre das Thinking
schon da und wird dann nachträglich gestreamt? Wir müssen sicherstellen, dass das ein
echtes Livestreaming ist … definitiv kein Fake Streaming, wenn wir die Ausgabe streamen.
Das sollte sauber implementiert sein, dass wirklich gestreamt wird.“

## Messbefund (Zahlen, keine Vermutung)

Store einer laufenden pi-Session (`data/sessions/18830ec6-…/events.jsonl`, 5317 Events):

| Beobachtung | Zahl |
| --- | --- |
| `assistant`-Ereignisse | 38, Median 265 Zeichen |
| größtes `assistant`-Ereignis | **3843 Zeichen in genau einem Event, ein Zeitstempel** |
| `thinking`-Ereignisse | 1212, Median 645,maximal 4018 Zeichen — ebenfalls Block-Granularität |
| Events mit Teiltext (wachsender Payload) | **0** |

Dazu im Code:

- `packages/adapters/pi/src/normalize.ts` — `IGNORED_UPDATES` enthält `text_start`,
  `text_delta`, `thinking_start`, `thinking_delta`, `toolcall_start`, `toolcall_delta`,
  `done`. Kommentar: „one event per finished content block (`*_end`), not per token
  delta“. Die Provider-Deltas existieren im pi-Stream, werden am Adapter verworfen.
- `packages/adapters/claude/src/normalize.ts:174` — `stream_event` wird explizit nicht
  ausgewickelt.
- `packages/contracts/src/sessions/event.ts` — `EVENT_TYPES` kennt keinen Delta-/Stream-Typ;
  `MAX_EVENT_PAYLOAD_BYTES = 4096`.
- `apps/pwa/src/shared/typewriter.ts` — `TW_TICK_MS = 40`, `TW_BASE_STEP = 2` (≈ 50
  Zeichen/s), `TW_IMMEDIATE_LAG = 300`, `TW_QUEUE_INSTANT = 8`.

## Was der Nutzer sieht

Der Hub empfängt den fertigen Block (oft erst am Ende des Turns). Die PWA tippt den
**bereits vollständigen** Text clientseitig mit ~50 Zeichen/s ab. Ab 300 Zeichen
Rückstand rastet sie sofort ein — lange Antworten erscheinen deshalb schlagartig, kurze
wirken wie live geschrieben. Beides ist Kosmetik: echt gestreamt wird nichts.

## Warum das ein Fehler ist

1. Es erzeugt eine vorgetäuschte Latenz: Der Anschein von Fortschritt, wo keiner mehr ist.
2. Es verschleiert die reale Pipeline — ein Adapter, der Deltas verwirft, fällt nie auf.
3. Es widerspricht der Anforderung: Wenn streamed wird, dann echt (ADR-0083).

## Fix-Richtung (ADR-0083)

- Block-Ereignisse bleiben die dauerhafte Wahrheit (JSONL, Snapshot, K5/K7/K8).
- Live-Deltas laufen als **transiente Frames** über den bestehenden ws-Tail, ohne
  EventStore; `AdapterContext` bekommt `ctx.stream(frame)`, Adapter kohärieren auf
  ≤ 10 Frames/s (Flush alle 150 ms oder ab 1 KB, Frame ≤ 4 KB).
- PWA hängt Frames in-place an; der einlaufende Block **ersetzt** die Live-Blase.
- Der Typewriter-Effekt für `assistant`/`thinking` wird entfernt.

## Schrittstand (verifiziert)

- [x] Messung + Ursachen (dieses Dokument, Zahlen oben)
- [ ] Contracts: `streamFrame` in `packages/contracts/src/sessions/stream.ts`
- [ ] AdapterContext `ctx.stream` + pi-Adapter kohäriert Deltas (claude folgt)
- [ ] Hub: Validierung + ws-Verteilung ohne Persistierung
- [ ] PWA: In-place-Frames, Typewriter-Fake für Agent-Ausgabe raus
- [ ] Tests: Adapter-Kohärenz, Hub-Frames (nicht persistiert), E2E mit Zeitbeleg
