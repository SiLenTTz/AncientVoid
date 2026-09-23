/**
 * T1.5-7 — browser-native STT (Web Speech API), MVP per EPIC-P1.5 §3.3:
 * chosen over a Whisper.cpp server because it needs zero infrastructure.
 * The Whisper.cpp path (originally P3 T3.6) remains the documented local
 * alternative for browsers without this API — not built here.
 *
 * Real, verified limitation (this dev machine, 2026-09-16): open-source
 * Chromium (Arch Linux build, 151.0.7922.173) exposes the
 * `webkitSpeechRecognition` constructor, but calling `.start()` never
 * fires ANY callback (no result, no error, no end) — confirmed via a real
 * Playwright run against the real binary, not assumed. Google's official
 * Chrome build ships a service key this API needs to reach Google's
 * speech backend; generic Chromium builds don't. This is exactly why
 * `recognize()` below has its own timeout: without one, a broken/unkeyed
 * browser leaves the UI stuck in "listening…" forever, indistinguishable
 * from an unusually quiet user. A real device's own browser (a phone's
 * Chrome/Safari) is expected to behave differently — unverified from
 * here, verify on a real device before trusting this on mobile.
 */

const RECOGNITION_TIMEOUT_MS = 10_000;

export function speechRecognitionSupported(): boolean {
  const w = window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
  return typeof w.SpeechRecognition === "function" || typeof w.webkitSpeechRecognition === "function";
}

export type SpeechResult =
  | { ok: true; text: string; latencyMs: number }
  | { ok: false; reason: "unsupported" | "no-speech" | "not-allowed" | "timeout" | "error"; detail?: string };

/**
 * Runs one recognition pass. Never auto-submits anything — the caller
 * always gets text back into an editable field, per §3.3's explicit
 * "Transkript ist immer editierbar vor dem Absenden" rule.
 */
export function recognizeOnce(lang = "de-DE"): Promise<SpeechResult> {
  return new Promise((resolve) => {
    if (!speechRecognitionSupported()) {
      resolve({ ok: false, reason: "unsupported" });
      return;
    }
    const Ctor = (window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike }).SpeechRecognition ??
      (window as unknown as { webkitSpeechRecognition: new () => SpeechRecognitionLike }).webkitSpeechRecognition;
    const recognition = new Ctor();
    recognition.lang = lang;
    recognition.interimResults = false;
    recognition.continuous = false;

    let settled = false;
    // K6: latency is measured from the moment recording actually starts
    // (onstart, not the .start() call itself, which can be queued behind
    // a permission prompt) to the transcript arriving.
    let startedAt = performance.now();

    const finish = (result: SpeechResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      resolve(result);
    };

    const timeoutId = setTimeout(() => {
      recognition.abort();
      finish({ ok: false, reason: "timeout" });
    }, RECOGNITION_TIMEOUT_MS);

    recognition.onstart = () => {
      startedAt = performance.now();
    };
    recognition.onresult = (event) => {
      const text = event.results?.[0]?.[0]?.transcript ?? "";
      finish({ ok: true, text, latencyMs: performance.now() - startedAt });
    };
    recognition.onerror = (event) => {
      const errorCode = event.error;
      const reason: "no-speech" | "not-allowed" | "error" =
        errorCode === "no-speech" ? "no-speech" : errorCode === "not-allowed" ? "not-allowed" : "error";
      finish({ ok: false, reason, detail: errorCode });
    };
    recognition.onend = () => {
      // Only reachable if neither onresult nor onerror fired first —
      // exactly the hung-recognition case this dev machine's Chromium
      // hits (see module comment). Timeout handles it if onend itself
      // never fires either.
      finish({ ok: false, reason: "error", detail: "ended without a result" });
    };

    try {
      recognition.start();
    } catch (err) {
      finish({ ok: false, reason: "error", detail: err instanceof Error ? err.message : String(err) });
    }
  });
}

interface SpeechRecognitionResultLike {
  transcript: string;
}
interface SpeechRecognitionEventLike {
  results: { [i: number]: { [j: number]: SpeechRecognitionResultLike } };
}
interface SpeechRecognitionErrorEventLike {
  error: string;
}
interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onstart: (() => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start(): void;
  abort(): void;
}
