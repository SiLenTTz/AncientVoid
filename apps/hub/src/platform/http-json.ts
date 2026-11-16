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
 */
export function httpJson<T = unknown>(
  url: string,
  init: { method?: string; token?: string; body?: unknown; timeoutMs?: number } = {},
): Promise<JsonResponse<T>> {
  const target = new URL(url);
  const payload = init.body === undefined ? undefined : JSON.stringify(init.body);
  const request = target.protocol === "https:" ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
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
    req.setTimeout(init.timeoutMs ?? 5000, () => req.destroy(new Error(`timeout after ${init.timeoutMs ?? 5000} ms`)));
    req.on("error", reject);
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}
