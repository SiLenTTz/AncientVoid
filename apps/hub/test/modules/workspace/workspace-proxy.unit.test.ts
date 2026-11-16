import { describe, expect, it } from "vitest";
import { forwardQuery, originAllowed, proxySubPath, rewriteLocation } from "../../../src/modules/workspace/workspace-proxy.ts";
import { isWorkspaceProxyTicketRequest } from "../../../src/platform/auth.ts";

/** EPIC-P29 T29.6: die Isolationsteile des Preview-Proxys als reine Funktionen. */
describe("workspace-proxy: Pfad-, Query-, Origin- und Redirect-Isolation", () => {
  it("proxySubPath: leer oder /-relativ; Traversal (auch kodiert), //, \\, NUL und Länge sind unzulässig", () => {
    expect(proxySubPath(undefined)).toBe("");
    expect(proxySubPath("")).toBe("");
    expect(proxySubPath("sub/x")).toBe("/sub/x");
    expect(proxySubPath("/sub/x")).toBe("/sub/x");
    for (const bad of ["/..", "/a/../b", "/%2e%2e", "/%2E%2E/b", "/a//b", "/a\\b", "/a%5Cb", "/a%00b", "/" + "a".repeat(600)]) {
      expect(proxySubPath(bad.slice(1)), bad).toBeNull();
    }
    expect(proxySubPath("/" + "%2e".repeat(300))).toBeNull(); // dekodiert zu lang oder Traversal
  });

  it("forwardQuery: token und ticket fallen immer weg, Rest bleibt", () => {
    expect(forwardQuery("")).toBe("");
    expect(forwardQuery("a=1&b=2")).toBe("?a=1&b=2");
    expect(forwardQuery("a=1&token=SECRET&ticket=tok&b=2")).toBe("?a=1&b=2");
    expect(forwardQuery("token=SECRET")).toBe("");
  });

  it("originAllowed: Origin muss zum Request-Host passen; cross-site fetchen ist raus", () => {
    expect(originAllowed(undefined, "hub.tailnet.ts.net", undefined)).toBe(true);
    expect(originAllowed("https://hub.tailnet.ts.net", "hub.tailnet.ts.net", undefined)).toBe(true);
    expect(originAllowed("https://hub.tailnet.ts.net:443", "hub.tailnet.ts.net", undefined)).toBe(true);
    expect(originAllowed("https://evil.example", "hub.tailnet.ts.net", undefined)).toBe(false);
    expect(originAllowed("https://hub.tailnet.ts.net.evil.example", "hub.tailnet.ts.net", undefined)).toBe(false);
    expect(originAllowed("kein url", "hub", undefined)).toBe(false);
    expect(originAllowed(undefined, "hub", "same-origin")).toBe(true);
    expect(originAllowed(undefined, "hub", "none")).toBe(true);
    expect(originAllowed(undefined, "hub", "cross-site")).toBe(false);
    expect(originAllowed(undefined, "hub", "same-site")).toBe(false);
  });

  it("rewriteLocation: relativ bleibt, eigener Loopback wird relativiert, extern fällt weg", () => {
    expect(rewriteLocation("/ziel?x=1", 8080)).toBe("/ziel?x=1");
    expect(rewriteLocation("http://127.0.0.1:8080/ziel", 8080)).toBe("/ziel");
    expect(rewriteLocation("http://127.0.0.1:9999/ziel", 8080)).toBeNull();
    expect(rewriteLocation("http://example.net/bye", 8080)).toBeNull();
    expect(rewriteLocation("//example.net/bye", 8080)).toBeNull();
    expect(rewriteLocation(undefined, 8080)).toBeNull();
  });

  it("isWorkspaceProxyTicketRequest: nur GET/HEAD, nur die Proxy-Route, nur mit Ticket-Parameter", () => {
    const url = (id: string) => `/api/sessions/${id}/workspace/services/web/proxy/?ticket=abc`;
    const uuid = "7a0d0e2f-1111-4000-8000-000000000000";
    expect(isWorkspaceProxyTicketRequest("GET", url(uuid))).toBe(true);
    expect(isWorkspaceProxyTicketRequest("HEAD", `/api/sessions/${uuid}/workspace/services/web/proxy/sub?ticket=`)).toBe(true);
    expect(isWorkspaceProxyTicketRequest("POST", url(uuid))).toBe(false);
    expect(isWorkspaceProxyTicketRequest("GET", `/api/sessions/${uuid}/workspace/services/web/proxy/`)).toBe(false);
    expect(isWorkspaceProxyTicketRequest("GET", `/api/sessions/${uuid}/workspace/services/web/logs?ticket=abc`)).toBe(false);
    expect(isWorkspaceProxyTicketRequest("GET", `/api/sessions?ticket=abc`)).toBe(false);
    expect(isWorkspaceProxyTicketRequest("GET", `/api/sessions/${uuid}/workspace/services/web/proxy/?ticketa=abc`)).toBe(false);
  });
});
