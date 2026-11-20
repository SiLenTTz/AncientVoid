import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

export interface JsonResponse<T> {
  status: number;
  body: T;
}

/**
 * Hub-to-hub HTTP without keep-alive. Node 26's fetch (undici 8.9) stalls
 * for seconds when it reuses an idle keep-alive socket; a fresh connection
 * per call avoids that and costs little between a handful of hubs.
 *
 * 2026-11-20: the timeout is a hard wall-clock deadline. req.setTimeout is
 * socket-inactivity only and never fires while TCP connect is pending, so an
 * offline peer (dropped SYNs, e.g. tailnet relay) hung /api/fleet for the
 * kernel's ~130 s SYN retransmission budget (observed 136 s; desktop UI
 * showed a grey screen until the request finally resolved).
 */
export function httpJson<T = unknown>(
  url: string,
  init: { method?: string; token?: string; body?: unknown; timeoutMs?: number } = {},
): Promise<JsonResponse<T>> {
  const target = new URL(url);
  const payload = init.body === undefined ? undefined : JSON.stringify(init.body);
  const request = target.protocol === "https:" ? httpsRequest : httpRequest;
  const timeoutMs = init.timeoutMs ?? 5000;
  return new Promise((resolve, reject) => {
    let deadline: NodeJS.Timeout | undefined = setTimeout(
      () => req.destroy(new Error(`timeout after ${timeoutMs} ms`)),
      timeoutMs,
    );
    const req = request(
      target,
      {
        method: init.method ?? (payload === undefined ? "GET" : "POST"),
        agent: false,
        headers: {
          accept: "application/json",
          ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
          ...(payload === undefined ? {} : { "content-type": "application/json", "content-length": Buffer.byteLength(payload) }),
        },
      },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => (text += chunk));
        res.on("end", () => {
          clearTimeout(deadline);
          deadline = undefined;
          let body: unknown;
          try {
            body = text ? JSON.parse(text) : null;
          } catch {
            body = { error: text.slice(0, 200) };
          }
          resolve({ status: res.statusCode ?? 0, body: body as T });
        });
      },
    );
    req.on("error", (err) => {
      clearTimeout(deadline);
      deadline = undefined;
      reject(err);
    });
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}
