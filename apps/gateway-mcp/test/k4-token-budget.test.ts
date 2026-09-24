import { describe, it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Tiktoken } from "js-tiktoken/lite";
import o200k from "js-tiktoken/ranks/o200k_base";
import cl100k from "js-tiktoken/ranks/cl100k_base";
import { buildGatewayServer } from "../src/server.ts";

/**
 * T4.7 (EPIC-P4 §3/AC-P4-2, K4): "3 Schemas < 1.000 Tokens statisch" — the
 * static cost of the gateway's own three advertised tool schemas
 * (hub_search/hub_describe/hub_exec), NOT the operations registry those
 * tools describe on demand (that's the whole point of the lazy-disclosure
 * pattern: the registry stays hidden until hub_describe is actually
 * called for one operation).
 *
 * Measured through a REAL MCP client/server round trip (InMemoryTransport
 * — a real linked transport pair, not a fake object) calling the real
 * `tools/list` method, so this is the exact manifest text an actual MCP
 * client would receive — not a hand-copied duplicate that could silently
 * drift from what server.ts really registers.
 *
 * T7.4: counted with real tokenizers, not the former ~4-characters-per-token
 * rule — `o200k_base` (GPT-4o/GPT-5 family) and `cl100k_base`, both via
 * js-tiktoken 1.0.21. The budget must hold for each. The character rule is
 * kept as a third, printed number for comparison with older measurements.
 */
const TOKENIZERS = { o200k_base: new Tiktoken(o200k), cl100k_base: new Tiktoken(cl100k) };

describe("gateway-mcp K4 static token budget", () => {
  it("has exactly three tools", async () => {
    const server = buildGatewayServer({ baseUrl: "http://127.0.0.1:1", token: "x" });
    const client = new Client({ name: "k4-test-client", version: "0.0.1" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name).sort()).toEqual(["hub_describe", "hub_exec", "hub_search"]);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("the real tools/list manifest stays under 1000 tokens — Premortem 1's anti-bloat gate", async () => {
    const server = buildGatewayServer({ baseUrl: "http://127.0.0.1:1", token: "x" });
    const client = new Client({ name: "k4-test-client", version: "0.0.1" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      const { tools } = await client.listTools();
      const manifestText = JSON.stringify(tools);
      const counts = Object.fromEntries(Object.entries(TOKENIZERS).map(([name, enc]) => [name, enc.encode(manifestText).length]));
      console.log(`K4 manifest: ${JSON.stringify(counts)}, chars/4=${Math.ceil(manifestText.length / 4)}`);
      for (const [name, tokens] of Object.entries(counts)) {
        expect(tokens, name).toBeGreaterThan(0); // sanity: a real, non-empty manifest was actually measured
        expect(tokens, name).toBeLessThan(1000);
      }
    } finally {
      await client.close();
      await server.close();
    }
  });
});
