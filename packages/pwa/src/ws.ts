import { newEvents, shouldResync } from "./ws-protocol.ts";

/**
 * WS delta-protocol client (counterpart of packages/server/src/ws.ts).
 * Tracks seq per session, detects gaps, resyncs from the store.
 * Reconnects with exponential backoff; reports connection state.
 */
export interface NormalizedEvent {
  seq: number;
  ts: string;
  sessionId: string;
  type: string;
  summary: string;
  payload: Record<string, unknown>;
  blobRef: string | null;
  tokensEst?: number;
}

export interface TailConnection {
  close(): void;
}

export interface TailOptions {
  url: string;
  token: string;
  sessionId: string;
  onEvents: (events: NormalizedEvent[]) => void;
  onState: (state: "connecting" | "live" | "reconnecting" | "closed") => void;
}

export function connectTail(opts: TailOptions): TailConnection {
  let lastSeq = 0;
  let closedByUser = false;
  let socket: WebSocket | null = null;
  let backoffMs = 500;

  const open = () => {
    opts.onState(lastSeq === 0 ? "connecting" : "reconnecting");
    const proto = opts.url.startsWith("https") ? "wss" : "ws";
    const base = opts.url.replace(/^https?/, proto);
    socket = new WebSocket(`${base}/api/events/${opts.sessionId}/tail?token=${encodeURIComponent(opts.token)}`);

    socket.onopen = () => {
      backoffMs = 500;
      socket?.send(JSON.stringify({ type: "hello", lastSeq }));
    };

    socket.onmessage = (msg) => {
      try {
        const data = JSON.parse(String(msg.data)) as
          | { type: "events"; events: NormalizedEvent[]; highWater: number; dropped: boolean; baseline?: boolean }
          | { type: "welcome"; lastSeq: number }
          | { type: "error"; message: string }
          | { type: "pong" };
        if (data.type === "events") {
          // BUG-0026: an opening view starts at the newest history page.
          if (data.baseline && lastSeq === 0 && data.events[0]) lastSeq = data.events[0].seq - 1;
          const incoming = newEvents(lastSeq, data.events);
          const first = incoming[0];
          if (shouldResync(lastSeq, first?.seq, data.dropped)) {
            // Gap or dropped batch — resync from last known seq.
            socket?.send(JSON.stringify({ type: "resync", since: lastSeq }));
            return;
          }
          if (incoming.length > 0) {
            lastSeq = incoming[incoming.length - 1]!.seq;
            opts.onState("live");
            opts.onEvents(incoming);
          }
        } else if (data.type === "welcome") {
          opts.onState("live");
        } else if (data.type === "error") {
          console.warn("[tail] server:", data.message);
        }
      } catch {
        // ignore malformed frame
      }
    };

    socket.onclose = () => {
      if (closedByUser) {
        opts.onState("closed");
        return;
      }
      setTimeout(open, backoffMs);
      backoffMs = Math.min(backoffMs * 2, 10_000);
    };
  };

  open();

  return {
    close() {
      closedByUser = true;
      socket?.close();
    },
  };
}
