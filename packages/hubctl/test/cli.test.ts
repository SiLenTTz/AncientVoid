import { describe, it, expect } from "vitest";
import { buildWsUrl } from "../src/cli.ts";

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
