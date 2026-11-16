import type { Page } from "@playwright/test";

/** Browser recognizer contract: a final segment stays in the preview until stop. */
export async function installSpeechRecognition(page: Page): Promise<void> {
  await page.addInitScript(() => {
    class FakeRecognition {
      onstart: (() => void) | null = null;
      onresult: ((event: unknown) => void) | null = null;
      onend: (() => void) | null = null;
      start() {
        setTimeout(() => {
          this.onstart?.();
          const text = (globalThis as unknown as { __speech?: string }).__speech ?? "stopp";
          this.onresult?.({ resultIndex: 0, results: [{ isFinal: true, length: 1, 0: { transcript: text } }] });
        }, 30);
      }
      stop() { this.onend?.(); }
      abort() { this.onend?.(); }
    }
    (globalThis as unknown as { SpeechRecognition: unknown }).SpeechRecognition = FakeRecognition;
  });
}
