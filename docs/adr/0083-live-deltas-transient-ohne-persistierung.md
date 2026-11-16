# ADR-0083: Live-Deltas als transiente Frames — Block-Ereignisse bleiben autoritativ

**Status:** angenommen (Implementierung im Zweig `feat/echtes-livestreaming`, PR folgt)
**Datum:** 2026-11-16 · **Bezug:** BUG-0179, K2 (Last), K5 (≤ 4 KB), K7 (Recovery), K8 (20 × 30 ev/s)

Die Nummern 0081 und 0082 sind in den offenen PRs #17 bzw. #30 belegt.

## Kontext

Nutzeranforderung: die Agent-Ausgabe muss **echt live** erscheinen — „kein Fake Streaming“.
Messung an einer echten pi-Session (`data/sessions/18830ec6-…/events.jsonl`, 5317 Events):

- 38 `assistant`-Ereignisse, Median 265 Zeichen, **maximal 3843 Zeichen in genau einem
  Ereignis mit genau einem Zeitstempel**.
- 1212 `thinking`-Ereignisse, Median 645, maximal 4018 Zeichen — ebenfalls Block-Granularität.
- `packages/adapters/pi/src/normalize.ts`: `text_start`, `text_delta`, `thinking_start`,
  `thinking_delta`, `toolcall_*` stehen in `IGNORED_UPDATES` — die Token-Deltas von
  `pi --mode json` werden am Adapter **verworfen**.
- `packages/adapters/claude/src/normalize.ts:174`: `stream_event` wird explizit nicht
  ausgewickelt (nur ein System-Hinweis).
- `packages/contracts/src/sessions/event.ts`: `EVENT_TYPES` = user, assistant, thinking,
  tool_use, tool_result, gate, error, system — **kein Delta-Typ**.
- `apps/pwa/src/shared/typewriter.ts`: `TW_TICK_MS = 40`, `TW_BASE_STEP = 2`
  (≈ 50 Zeichen/s), `TW_IMMEDIATE_LAG = 300` → ab 300 Zeichen Rückstand rastet der Text
  **schlagartig** ein. Kurze Antworten wirken also getippt, lange erscheinen auf einen
  Schlag. Der Eindruck „das Thinking ist längst fertig und wird nachträglich gestreamt“
  ist damit zutreffend: Es ist clientseitige Kosmetik über bereits vollständig empfangenem Text.

## Entscheidung

1. **Block-Ereignisse bleiben die dauerhafte Wahrheit.** `assistant`/`thinking`-Blöcke
   bleiben wie bisher in JSONL + Snapshot (Suche, History, K5-4-KB-Grenze, K7-Recovery).
   Kein neuer persistierter Event-Typ.
2. **Live-Deltas sind transiente Frames.** Neuer Frame-Typ im Contracts-Paket
   (`sessions/stream.ts`: `streamFrame`: `sessionId`, `turnId`, `stream`
   (`assistant` | `thinking`), `seq`, `text`, `final`). `AdapterContext` bekommt
   `ctx.stream(frame)` (Adapter-Contract-Änderung — dieser ADR). Der Hub prüft gegen das
   Schema und verteilt die Frames über den bestehenden ws-Tail
   (`/sessions/:id/tail`), **ohne** EventStore, Snapshot oder Zählung in der Event-Historie.
3. **Adapter kohärieren statt tokenweise zu senden.** Flush spätestens alle 150 ms oder bei
   ≥ 1 KB Puffer, Frame immer ≤ 4 KB, `seq` lückenlos je `(turnId, stream)`, `final: true`
   am letzten Frame vor dem Block. Zielgröße: ≤ 10 Frames/s pro Session.
4. **PWA hängt Frames in-place an eine vorläufige Live-Blase** (Key `turnId`+`stream`).
   Trifft der dauerhafte Block ein, **ersetzt** er die Blase — keine doppelten Texte,
   keine Nachbestellung verlorener Frames.
5. **Der vorgetäuschte Tipp-Effekt für `assistant`/`thinking` entfällt.** EPIC-P58
   (Typewriter) wird für Agent-Ausgabe entfernt: wo echtes Streaming möglich ist, ist
   Nacherzählen eine Fälschung. Verbleibende Tipp-Effekte nur dort, wo sie keine
   Agent-Ausgabe darstellen (z. B. locally generierte Hinweise) — wenn überhaupt.

## Grenzen (bewusst)

- Reconnect oder Beitritt mitten im Turn liefert verpasste Frames **nicht** nach; der
  Beitrag erscheint vollständig, sobald der Block eintrifft. Transiente Frames sind
  Darstellung, nicht Zustand — K7 bleibt unberührt.
- Frames verlieren ihre Reihenfolge nicht (ws ist geordnet); Lücken signalisiert der
  Client durch „wird ergänzt“, bis der Block kommt.
- Adapter ohne Delta-Quelle im Provider-Stream senden keine Frames — dann erscheint die
  Ausgabe blockweise, **ohne** vorzutäuschen, es werde live geschrieben.

## Konsequenzen

- Adapter-Contract erweitert (`ctx.stream`) — Adapter-Isolation bleibt: nur `AdapterContext`.
- K8-/K2-Betrachtung: keine neuen dauerhaften Events; ws-Rate steigt um ≤ 10 Frames/s pro
  aktiver Session. Messlatte: Lasttest unverändert grün, ws-Frame-Rate wird gemessen.
- Sichtbares Feature verschwindet (Appearance-Schalter „Tippeffekt“ für Agent-Ausgabe) →
  Nutzer-Doku und E2E-Specs zu EPIC-P58 müssen mitgezogen werden.
- Fail-loud-Regel bleibt: unbekannte Provider-Stream-Typen werden weiterhin als
  System-Ereignis sichtbar, nicht still verworfen.
