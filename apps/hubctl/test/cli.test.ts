import { describe, it, expect } from "vitest";
import { buildWsUrl, formatHealth } from "../src/cli.ts";

/**
 * BUG-0005: `followWs()` built its WS URL with `BASE.replace(/^https?/, "")`
 * — that regex strips "http(s)" but not the trailing ":", so
 * "http://127.0.0.1:7373" became "ws:://127.0.0.1:7373" (invalid URL).
 * hubctl had no tests at all before this, which is exactly how a CLI whose
 * README quick-start literally demonstrates `hubctl tail -f` shipped with
 * that path permanently broken.
 */
describe("buildWsUrl", () => {
  it("maps http:// to ws:// without a double colon", () => {
    const url = buildWsUrl("http://127.0.0.1:7373", "", "sess-1");
    expect(url).toBe("ws://127.0.0.1:7373/api/events/sess-1/tail");
  });

  it("maps https:// to wss://", () => {
    const url = buildWsUrl("https://hub.tailnet.ts.net", "", "sess-1");
    expect(url).toBe("wss://hub.tailnet.ts.net/api/events/sess-1/tail");
  });

  it("appends the token as an encoded query param when present", () => {
    const url = buildWsUrl("http://127.0.0.1:7373", "a b/c", "sess-1");
    expect(url).toBe("ws://127.0.0.1:7373/api/events/sess-1/tail?token=a%20b%2Fc");
  });

  it("omits the query string entirely when there is no token", () => {
    const url = buildWsUrl("http://127.0.0.1:7373", "", "sess-1");
    expect(url).not.toContain("?");
  });

  it("produces a URL the WHATWG URL parser accepts", () => {
    expect(() => new URL(buildWsUrl("http://127.0.0.1:7373", "tok", "sess-1"))).not.toThrow();
  });
});

describe("formatHealth (T4.5-6)", () => {
  it("prints status, session counts and checks when present", () => {
    expect(
      formatHealth({
        ok: true,
        status: "ok",
        adapters: [{ id: "dummy", version: "0.1.0" }],
        checks: { database: { ok: true }, eventStore: { ok: true } },
        sessions: { live: 1, total: 2 },
      }),
    ).toEqual([
      "ok: true  status=ok",
      "  sessions live=1 total=2",
      "  checks db=ok store=ok",
      "  adapter dummy@0.1.0",
    ]);
  });

  it("still works with the pre-P4.5 {ok, adapters} payload", () => {
    expect(formatHealth({ ok: true, adapters: [] })).toEqual(["ok: true"]);
  });
});
