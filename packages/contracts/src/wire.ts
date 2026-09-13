import { z } from "zod";
import { NormalizedEvent } from "./event.ts";

/**
 * WS delta protocol (ADR-P0-4): server sends numbered deltas, client detects
 * gaps and resyncs. Drop-on-slow: the server buffers at most
 * MAX_WS_BUFFER events per socket, then drops and flags a resync.
 */
export const WS_PROTOCOL_VERSION = 1;

export const MAX_WS_BUFFER = 100;

/** Client → server. */
export const WsClientMessage = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("hello"),
    /** Highest seq the client knows; 0 = full tail from the beginning. */
    lastSeq: z.number().int().nonnegative().default(0),
  }),
  z.object({
    type: z.literal("resync"),
    since: z.number().int().nonnegative(),
  }),
  z.object({ type: z.literal("ping") }),
]);
export type WsClientMessage = z.infer<typeof WsClientMessage>;

/** Server → client. */
export const WsServerMessage = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("welcome"),
    sessionId: z.string(),
    lastSeq: z.number().int().nonnegative(),
    serverTime: z.string(),
  }),
  z.object({
    type: z.literal("events"),
    sessionId: z.string(),
    events: z.array(NormalizedEvent),
    /** Highest seq contained in this batch. */
    highWater: z.number().int().nonnegative(),
    /** true if events were dropped for a slow consumer → client must resync. */
    dropped: z.boolean().default(false),
  }),
  z.object({
    type: z.literal("snapshot"),
    sessionId: z.string(),
    status: z.string(),
    lastSeq: z.number().int().nonnegative(),
  }),
  z.object({ type: z.literal("pong") }),
  z.object({ type: z.literal("error"), message: z.string() }),
]);
export type WsServerMessage = z.infer<typeof WsServerMessage>;
