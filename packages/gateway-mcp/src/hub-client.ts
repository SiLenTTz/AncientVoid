/**
 * T4.6: the gateway's only way to reach the hub — a plain fetch against
 * its real REST API, authenticated with a real device token (the gateway
 * IS a device as far as the hub's own auth model is concerned; it gets
 * issued a token the same way a phone does, via `hubctl token issue`).
 * No shortcuts into hub internals — the gateway is exactly as privileged
 * as any other authenticated client, never more.
 */
export interface HubClientConfig {
  baseUrl: string;
  token: string;
}

export async function callHub(
  cfg: HubClientConfig,
  req: { method: "GET" | "POST"; path: string; body?: unknown },
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${cfg.baseUrl}${req.path}`, {
    method: req.method,
    headers: {
      authorization: `Bearer ${cfg.token}`,
      ...(req.body !== undefined ? { "content-type": "application/json" } : {}),
    },
    ...(req.body !== undefined ? { body: JSON.stringify(req.body) } : {}),
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}
