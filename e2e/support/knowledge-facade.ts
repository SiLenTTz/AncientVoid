import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createFakeFacade, type FakeFacadeOptions } from "../../packages/core/test/modules/knowledge/fake-facade.ts";

/**
 * EPIC-P74 T74.6a: die Test-Fassade (§3.3.1) auf Loopback, damit der echte
 * Hub-Prozess sie über echtes HTTP erreicht — kein Librarian, keine Cloud.
 */
export async function startKnowledgeFacade(opts: FakeFacadeOptions = {}): Promise<{ url: string; server: Server }> {
  const facade = createFakeFacade(opts);
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
      const body = chunks.length ? Buffer.concat(chunks) : undefined;
      void facade
        .handle(new Request(`http://${req.headers.host}${req.url}`, { method: req.method ?? "GET", headers, ...(body && req.method !== "GET" ? { body } : {}) }))
        .then(async (r) => {
          res.writeHead(r.status, Object.fromEntries(r.headers));
          res.end(Buffer.from(await r.arrayBuffer()));
        })
        .catch(() => (res.writeHead(500), res.end()));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  server.unref();
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`, server };
}
