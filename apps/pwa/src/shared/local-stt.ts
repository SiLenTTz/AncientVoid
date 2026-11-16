import { hubApi } from "./api.ts";
import { LocalSttStream } from "./stt-stream.ts";

/**
 * T10.2 (ADR-0028): push to talk, recognised on our own hardware. The
 * phone records, the hub transcribes (whisper.cpp) — no audio to a cloud.
 * Without a local recogniser the app says so and uses the browser's.
 */
let status: Promise<{ available: boolean; engine?: string; streaming?: boolean }> | null = null;

export function sttStatus(): Promise<{ available: boolean; engine?: string; streaming?: boolean }> {
  status ??= hubApi.stt().catch(() => ({ available: false }));
  return status;
}

export function recordingSupported(): boolean {
  return typeof MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
}

/**
 * BUG-0177: Diktat muss auch nach einer Minute und nach fünf noch laufen. Vorher
 * 60 s — wer länger sprach, dessen Aufnahme endete still. 15 Minuten sind die
 * Obergrenze (Opus im MediaRecorder braucht dafür gut 3 MB, die Hub-Grenze liegt
 * bei 8 MB Audio). Beim Erreichen wird ganz normal gestoppt und transkribiert.
 */
const MAX_RECORDING_MS = 15 * 60_000;

export class LocalRecorder {
  private recorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private liveStt: LocalSttStream | null = null;
  private liveStart: Promise<void> | null = null;
  private chunks: Blob[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** When the person tapped "stop" — K6 counts from here (speech end). */
  stoppedAt = 0;

  async start(onAutoStop: () => void, callbacks: { onPartial?: (text: string) => void; onStreamError?: (message: string) => void } = {}): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, noiseSuppression: true, echoCancellation: true } });
    const mime = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4"].find((m) => MediaRecorder.isTypeSupported?.(m));
    this.recorder = new MediaRecorder(this.stream, mime ? { mimeType: mime } : undefined);
    this.chunks = [];
    this.recorder.ondataavailable = (e) => e.data.size > 0 && this.chunks.push(e.data);
    this.recorder.start(250);
    this.timer = setTimeout(onAutoStop, MAX_RECORDING_MS);
    if ((await sttStatus()).streaming) {
      this.liveStt = new LocalSttStream(callbacks.onPartial ?? (() => undefined), callbacks.onStreamError ?? (() => undefined));
      this.liveStart = this.liveStt.start(this.stream);
      void this.liveStart.catch(() => undefined);
    }
  }

  stop(): Promise<Blob> {
    this.stoppedAt = performance.now();
    if (this.timer) clearTimeout(this.timer);
    const rec = this.recorder;
    return new Promise((resolve) => {
      if (!rec || rec.state === "inactive") return resolve(new Blob(this.chunks));
      rec.onstop = () => {
        this.stream?.getTracks().forEach((t) => t.stop());
        resolve(new Blob(this.chunks, { type: rec.mimeType || "audio/webm" }));
      };
      rec.stop();
    });
  }

  /** The microphone track — "ended" when the device or permission goes away. */
  track(): MediaStreamTrack | undefined {
    return this.stream?.getAudioTracks()[0];
  }

  cancel(): void {
    if (this.timer) clearTimeout(this.timer);
    try {
      this.recorder?.stop();
    } catch {
      // already stopped
    }
    this.stream?.getTracks().forEach((t) => t.stop());
    this.liveStt?.cancel();
  }

  async transcribe(blob: Blob): Promise<LocalTranscript> {
    if (this.liveStt && this.liveStart) {
      try {
        await this.liveStart;
        const result = await this.liveStt.finish();
        return { ...result, k6Ms: Math.round(performance.now() - this.stoppedAt) };
      } catch {
        // Keep the original local full-clip route as an explicit fallback.
      }
    }
    return transcribe(blob, this.stoppedAt);
  }
}

export interface LocalTranscript {
  text: string;
  engine: string;
  /** Speech end (stop tap) → text in the field, milliseconds (K6). */
  k6Ms: number;
  serverMs: number;
}

async function transcribe(blob: Blob, stoppedAt: number): Promise<LocalTranscript> {
  const r = await hubApi.transcribe(blob);
  return { text: r.text, engine: r.engine, serverMs: r.latencyMs, k6Ms: Math.round(performance.now() - stoppedAt) };
}
