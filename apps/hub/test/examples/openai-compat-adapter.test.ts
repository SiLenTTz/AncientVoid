import { afterEach, describe, expect, it, vi } from "vitest";
import { makeRecordingContext, waitFor } from "@ancientvoid/adapter-testkit";
import { createAdapter } from "../../../../examples/adapters/openai-compat/adapter.ts";

/** BUG-0131: das OpenAI-kompatible Beispiel macht Parse- und Transportfehler sichtbar — auch bei Folgeprompts. */
const sse = (body: string) => new Response(new Blob([body]).stream(), { status: 200, headers: { "content-type": "text/event-stream" } });
const adapter = () => createAdapter({ baseUrl: "http://127.0.0.1:9/v1" });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("examples/openai-compat — Fehler werden sichtbar (BUG-0131)", () => {
  it("eine ungültige SSE-Datenzeile wird zum begrenzten error-Event, der Strom läuft weiter", async () => {
    vi.stubGlobal("fetch", async () => sse(`data: INVALID\n\ndata: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n`));
    const ctx = makeRecordingContext();
    await adapter().start({ adapter: "openai-compat", project: "/tmp", prompt: "test" }, ctx);
    await waitFor(() => ctx.events.some((e) => e.summary === "completion finished"));
    const error = ctx.events.find((e) => e.type === "error");
    expect(error?.summary).toMatch(/unlesbare Antwortzeile/);
    expect(JSON.stringify(error?.payload).length).toBeLessThan(1024);
    expect(ctx.events.some((e) => e.type === "assistant" && e.summary === "ok")).toBe(true);
  });

  it("ein Fehlerobjekt des Endpoints im Strom ist ein error-Event, kein stilles Nichts", async () => {
    vi.stubGlobal("fetch", async () => sse(`data: {"error":{"message":"model overloaded"}}\n\ndata: [DONE]\n\n`));
    const ctx = makeRecordingContext();
    await adapter().start({ adapter: "openai-compat", project: "/tmp", prompt: "test" }, ctx);
    await waitFor(() => ctx.events.some((e) => e.type === "error"));
    expect(ctx.events.find((e) => e.type === "error")?.summary).toMatch(/model overloaded/);
  });

  it("ein Transportfehler beim Folgeprompt wird zum error-Event", async () => {
    vi.stubGlobal("fetch", async () => sse(`data: [DONE]\n\n`));
    const ctx = makeRecordingContext();
    const a = adapter();
    const handle = await a.start({ adapter: "openai-compat", project: "/tmp" }, ctx);
    vi.stubGlobal("fetch", async () => {
      throw new Error("synthetic offline");
    });
    expect(await a.steer(handle, { kind: "prompt", text: "next" }, ctx)).toEqual({ ok: true });
    await waitFor(() => ctx.events.some((e) => e.type === "error"));
    expect(ctx.events.find((e) => e.type === "error")?.summary).toMatch(/synthetic offline/);
  });

  it("ein Abbruch durch die Session ist kein Fehler", async () => {
    const abort = new AbortController();
    vi.stubGlobal("fetch", async () => {
      abort.abort();
      throw new DOMException("The operation was aborted.", "AbortError");
    });
    const ctx = makeRecordingContext({ signal: abort.signal });
    await adapter().start({ adapter: "openai-compat", project: "/tmp", prompt: "test" }, ctx);
    await waitFor(() => ctx.events.some((e) => e.summary === "completion aborted"));
    expect(ctx.events.filter((e) => e.type === "error")).toHaveLength(0);
  });
});
