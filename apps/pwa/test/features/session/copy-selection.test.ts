import { describe, expect, it, vi } from "vitest";
import { COPY_RETRY_DELAY_MS, copyWithRetry } from "../../../src/features/session/copy-selection.ts";

/** BUG-0107: transient abgelehntes Clipboard-writeText darf die Auswahl
 * nicht still verlieren — genau ein gebundener Retry, dann ehrlich false. */
describe("copyWithRetry", () => {
  it("erster Versuch erfolgreich → true ohne Retry", async () => {
    const write = vi.fn(async () => undefined);
    await expect(copyWithRetry("text", write, async () => undefined)).resolves.toBe(true);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("transiente Ablehnung → genau ein Retry → true (das war der CI-Flake)", async () => {
    let calls = 0;
    const write = vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw new Error("clipboard busy under load");
    });
    const sleep = vi.fn(async () => undefined);
    await expect(copyWithRetry("MARKIER_MICH", write, sleep)).resolves.toBe(true);
    expect(write).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(COPY_RETRY_DELAY_MS);
  });

  it("dauerhaft abgelehnt (insecure context) → false, kein Endlos-Retry", async () => {
    const write = vi.fn(async () => {
      throw new Error("not allowed");
    });
    await expect(copyWithRetry("text", write, async () => undefined).then(
      (ok) => ok,
      () => "threw",
    )).resolves.toBe(false);
    expect(write).toHaveBeenCalledTimes(2);
  });
});
