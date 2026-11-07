import { describe, expect, it } from "vitest";
import { JsonRpcConnection } from "@ancientvoid/adapter-jsonrpc";

// BUG-0102: error.data trägt bei „Internal error" die echte Ursache.
describe("JsonRpcConnection error.data", () => {
  it("hängt error.data an die Fehlermeldung", async () => {
    const conn = new JsonRpcConnection(() => undefined, { onRequest: async () => null, onNotification: () => undefined });
    const p = conn.request("session/prompt", {});
    conn.feed(`${JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32603, message: "Internal error", data: "could not connect" } })}\n`);
    const err = await p.then(() => null, (e: unknown) => e as Error);
    expect(err?.message).toBe("Internal error: could not connect");
  });
});
