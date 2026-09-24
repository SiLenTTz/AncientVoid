import { hubApi } from "./api.ts";

/**
 * T10.2 (ADR-0028): push to talk, recognised on our own hardware. The
 * phone records, the hub transcribes (whisper.cpp) — no audio to a cloud.
 * Without a local recogniser the app says so and uses the browser's.
 */
let status: Promise<{ available: boolean; engine?: string }> | null = null;

export function sttStatus(): Promise<{ available: boolean; engine?: string }> {
  status ??= hubApi.stt().catch(() => ({ available: false }));
  return status;
}

export function recordingSupported(): boolean {
  return typeof MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
}

const MAX_RECORDING_MS = 60_000;

export class LocalRecorder {
  private recorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private chunks: Blob[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** When the person tapped "stop" — K6 counts from here (speech end). */
  stoppedAt = 0;

  async start(onAutoStop: () => void): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, noiseSuppression: true, echoCancellation: true } });
    const mime = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4"].find((m) => MediaRecorder.isTypeSupported?.(m));
    this.recorder = new MediaRecorder(this.stream, mime ? { mimeType: mime } : undefined);
    this.chunks = [];
    this.recorder.ondataavailable = (e) => e.data.size > 0 && this.chunks.push(e.data);
    this.recorder.start(250);
    this.timer = setTimeout(onAutoStop, MAX_RECORDING_MS);
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
  }
}

export interface LocalTranscript {
  text: string;
  engine: string;
  /** Speech end (stop tap) → text in the field, milliseconds (K6). */
  k6Ms: number;
  serverMs: number;
}

export async function transcribe(blob: Blob, stoppedAt: number): Promise<LocalTranscript> {
  const r = await hubApi.transcribe(blob);
  return { text: r.text, engine: r.engine, serverMs: r.latencyMs, k6Ms: Math.round(performance.now() - stoppedAt) };
}
