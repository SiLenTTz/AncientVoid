import { randomUUID } from "node:crypto";
import {
  MAX_STREAM_FRAME_CHARS,
  STREAM_FLUSH_INTERVAL_MS,
  STREAM_FLUSH_MIN_CHARS,
  type EmittedStreamFrame,
} from "@ancientvoid/contracts";

/**
 * ADR-0083: Kohärenz-Stufe für Live-Frames im pi-Adapter.
 *
 * pi schickt tokenweise `text_delta`/`thinking_delta` (echte Aufnahme:
 * `test/fixtures/tool-use.jsonl`, 12 text_delta + 11 thinking_delta in einem Zug).
 * Token für Token weiterzureichen wäre Fake-Granularität mit realen Kosten — 30-100
 * Frames/s pro Session, und der Client kann gar nicht so schnell rendern. Also wird
 * gebündelt: spätestens nach `STREAM_FLUSH_INTERVAL_MS`, früher bei
 * `STREAM_FLUSH_MIN_CHARS`, und ein Frame bleibt unter `MAX_STREAM_FRAME_CHARS`.
 * Das ist immer noch echt live (≤ 150 ms nach dem Token), aber trägheitsarm.
 */
export type StreamKind = "assistant" | "thinking";

interface Block {
  turnId: string;
  seq: number;
  buf: string;
  timer: ReturnType<typeof setTimeout> | null;
}

export interface LivePump {
  /** Block beginnt (`text_start`/`thinking_start`) — setzt die Frameserie in Gang. */
  begin(kind: StreamKind): void;
  delta(kind: StreamKind, text: string): void;
  /** `text_end`/`thinking_end`: letzter Frame mit `final`, vor dem Block-Ereignis. */
  end(kind: StreamKind): void;
  /** Prozess-Ende: nichts mehr senden, offene Timer weg. */
  close(): void;
  /** Nur für Tests: wie viele Frames schon unterwegs waren. */
  sent(): number;
}

export function createLivePump(send: (frame: EmittedStreamFrame) => void): LivePump {
  const blocks = new Map<StreamKind, Block>();
  let sent = 0;
  let closed = false;

  const open = (kind: StreamKind): Block => {
    let b = blocks.get(kind);
    if (!b) {
      // pi sendet `*_start` nicht immer (z. B. nach Reconnect/Recovery) — dann wird
      // die Serie beim ersten Delta angefangen, ohne etwas zu erfinden.
      b = { turnId: randomUUID(), seq: 0, buf: "", timer: null };
      blocks.set(kind, b);
    }
    return b;
  };

  const emitFrames = (kind: StreamKind, final: boolean): void => {
    const b = blocks.get(kind);
    if (!b) return;
    if (b.timer) {
      clearTimeout(b.timer);
      b.timer = null;
    }
    const chunks: string[] = [];
    for (let i = 0; i < b.buf.length; i += MAX_STREAM_FRAME_CHARS) chunks.push(b.buf.slice(i, i + MAX_STREAM_FRAME_CHARS));
    b.buf = "";
    for (const [i, chunk] of chunks.entries()) {
      if (closed) return;
      send({ turnId: b.turnId, stream: kind, seq: b.seq++, text: chunk, final: final && i === chunks.length - 1 });
      sent++;
    }
    if (final) blocks.delete(kind);
  };

  return {
    begin(kind) {
      const b = open(kind);
      if (b.seq === 0 && b.buf === "") b.turnId = randomUUID();
    },
    delta(kind, text) {
      if (closed || !text) return;
      const b = open(kind);
      b.buf += text;
      if (b.buf.length >= STREAM_FLUSH_MIN_CHARS) {
        emitFrames(kind, false);
        return;
      }
      if (!b.timer) b.timer = setTimeout(() => emitFrames(kind, false), STREAM_FLUSH_INTERVAL_MS);
    },
    end(kind) {
      emitFrames(kind, true);
    },
    close() {
      closed = true;
      for (const kind of [...blocks.keys()]) {
        const b = blocks.get(kind);
        if (b?.timer) clearTimeout(b.timer);
        blocks.delete(kind);
      }
    },
    sent() {
      return sent;
    },
  };
}
