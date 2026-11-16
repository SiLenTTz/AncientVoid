import { z } from "zod";

/**
 * ADR-0083: transiente Live-Frames für echtes Streaming.
 *
 * Dauerhafte Wahrheit bleiben die Block-Ereignisse (`assistant`, `thinking` in
 * `event.ts`). Diese Frames sind ausschließlich Darstellung unterwegs zum Client:
 * sie landen **nicht** im EventStore, nicht im Snapshot und zählen nicht in der
 * Event-Sequenz. Ein Client, der Frames verpasst (Reconnect, View mitten im Turn),
 * bekommt den Beitrag, sobald der Block eintrifft — deshalb ist eine Frame-Lücke
 * kein Resync-Anlass.
 *
 * Adapter kohärieren: Flush spätestens nach `STREAM_FLUSH_INTERVAL_MS` oder wenn der
 * Puffer `STREAM_FLUSH_MIN_CHARS` erreicht; ein Frame bleibt immer unter
 * `MAX_STREAM_FRAME_CHARS` (K5-kompatible Grenze, damit ein Frame nie größer ist als
 * ein Ereignis).
 */
export const MAX_STREAM_FRAME_CHARS = 4096;
export const STREAM_FLUSH_INTERVAL_MS = 150;
export const STREAM_FLUSH_MIN_CHARS = 1024;

/** Was ein Adapter durch `ctx.stream()` meldet — sessionId vergibt der Hub. */
export const EmittedStreamFrame = z.object({
  /** Laufende Folge innerhalb eines Turns: der Adapter erzeugt sie beim ersten
   * Delta eines Blocks und hält sie bis `final` gleich. Dient dem Client nur als
   * Gruppenschlüssel, hat keine Bedeutung im dauerhaften Protokoll. */
  turnId: z.string().min(1).max(120),
  stream: z.enum(["assistant", "thinking"]),
  /** Lückenlos je (turnId, stream) von 0 an; der Hub prüft das. */
  seq: z.number().int().nonnegative(),
  text: z.string().min(1).max(MAX_STREAM_FRAME_CHARS),
  /** Letzter Frame vor dem zugehörigen Block-Ereignis. */
  final: z.boolean().default(false),
});
export type EmittedStreamFrame = z.infer<typeof EmittedStreamFrame>;

/** Hub → Client über den bestehenden ws-Tail (eigener Typ, keine Event-Sequenz). */
export const WsStreamFrames = z.object({
  type: z.literal("stream"),
  sessionId: z.string(),
  frames: z.array(EmittedStreamFrame).min(1).max(32),
});
export type WsStreamFrames = z.infer<typeof WsStreamFrames>;
