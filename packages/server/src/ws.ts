import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import {
  MAX_WS_BUFFER,
  WsClientMessage,
  type NormalizedEvent,
  type WsServerMessage,
} from "@uacc/contracts";
import type { SessionManager } from "@uacc/core";

/**
 * WS delta protocol (ADR-P0-4):
 *  - Server sends numbered event batches with a highWater seq.
 *  - Client detects gaps (highWater jumps) and requests {type:"resync", since}.
 *  - Drop-on-slow: per-socket buffer capped at MAX_WS_BUFFER (100). When a
 *    consumer can't keep up, older events are dropped and the next batch is
 *    flagged dropped:true — the client resyncs from the store. No backpressure
 *    lag, ever (K2).
 */
export function registerWs(app: FastifyInstance, sessions: SessionManager): void {
  app.get("/api/events/:id/tail", { websocket: true }, (socket: WebSocket, req) => {
    const sessionId = (req.params as { id: string }).id;
    const send = (msg: WsServerMessage) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg));
    };

    if (!sessions.get(sessionId)) {
      send({ type: "error", message: "unknown session" });
      socket.close();
      return;
    }

    let dropped = false;
    let buffer: NormalizedEvent[] = [];
    let flushing = false;

    const flush = async () => {
      if (flushing || buffer.length === 0) return;
      flushing = true;
      try {
        while (buffer.length > 0) {
          const batch = buffer;
          buffer = [];
          const last = batch[batch.length - 1]!;
          send({
            type: "events",
            sessionId,
            events: batch,
            highWater: last.seq,
            dropped,
          });
          dropped = false;
          // Yield to the event loop between batches.
          await new Promise((r) => setImmediate(r));
        }
      } finally {
        flushing = false;
      }
    };

    const unsubscribe = sessions.subscribe(sessionId, (events) => {
      if (buffer.length + events.length > MAX_WS_BUFFER) {
        // Drop oldest to keep the newest MAX_WS_BUFFER events; flag consumer.
        buffer = [...buffer, ...events].slice(-MAX_WS_BUFFER);
        dropped = true;
      } else {
        buffer.push(...events);
      }
      void flush();
    });

    socket.on("message", async (raw: Buffer) => {
      let parsed: WsClientMessage | null = null;
      try {
        parsed = WsClientMessage.parse(JSON.parse(raw.toString()));
      } catch {
        send({ type: "error", message: "invalid message" });
        return;
      }
      if (!parsed) return;
      switch (parsed.type) {
        case "hello": {
          if (parsed.lastSeq === 0) {
            const events = await sessions.tail(sessionId, 0, MAX_WS_BUFFER);
            if (events.length > 0) {
              buffer = events;
              void flush();
            } else {
              send({
                type: "welcome",
                sessionId,
                lastSeq: 0,
                serverTime: new Date().toISOString(),
              });
            }
          } else {
            // Client knows up to lastSeq — anything missed is fetched via resync.
            send({
              type: "welcome",
              sessionId,
              lastSeq: parsed.lastSeq,
              serverTime: new Date().toISOString(),
            });
          }
          break;
        }
        case "resync": {
          const events = await sessions.tail(sessionId, parsed.since, MAX_WS_BUFFER);
          buffer = events;
          dropped = false;
          void flush();
          break;
        }
        case "ping":
          send({ type: "pong" });
          break;
      }
    });

    socket.on("close", () => unsubscribe());
  });
}
