import type { FastifyInstance } from "fastify";
import type { AiMetricsReport, AiMetricsSourceReport } from "@ancientvoid/contracts";
import { AiMetricsReport as AiMetricsReportSchema } from "@ancientvoid/contracts";
import type { RouteContext } from "../../route-context.ts";

/**
 * EPIC-P59 (ADR-0078): Les-API für die Metrik-Seite — REST, keine
 * EventBus-Payloads (K5). Ohne konfigurierten Sampler antwortet der Endpunkt
 * mit leerer Quelle-Liste statt stiller Nullen (ADR-0078).
 * Nachtrag: optional Peer-Reports mergen (`aimetricsMergePeers`).
 */

const PEER_TIMEOUT_MS = 2_500;

function prefixSources(hostId: string, sources: AiMetricsSourceReport[]): AiMetricsSourceReport[] {
  return sources.map((s) => ({
    ...s,
    id: `${hostId}:${s.id}`,
    label: s.label.startsWith(`${hostId} `) || s.label.startsWith(`${hostId}·`) ? s.label : `${hostId} · ${s.label}`,
  }));
}

async function fetchPeerReport(url: string, token: string): Promise<AiMetricsReport | { error: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PEER_TIMEOUT_MS);
  try {
    const res = await fetch(`${url.replace(/\/$/, "")}/api/aimetrics`, {
      headers: { authorization: `Bearer ${token}` },
      signal: ctrl.signal,
    });
    if (!res.ok) return { error: `HTTP ${res.status}` };
    return AiMetricsReportSchema.parse(await res.json());
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

export function registerAiMetricsRoutes(app: FastifyInstance, ctx: RouteContext): void {
  app.get("/api/aimetrics", async (): Promise<AiMetricsReport> => {
    const sampler = ctx.deps.aimetrics;
    const local: AiMetricsReport = sampler
      ? sampler.report()
      : {
          generatedAt: new Date().toISOString(),
          intervalSec: 10,
          windowSec: 900,
          self: { hostLabel: ctx.hostLabel ?? ctx.hostId },
          sources: [],
        };

    if (!ctx.deps.aimetricsMergePeers || !ctx.deps.fleet) return local;

    const peers = ctx.deps.fleet.peers();
    if (peers.length === 0) return local;

    const peerParts = await Promise.all(
      peers.map(async (peer) => {
        const result = await fetchPeerReport(peer.url, peer.token);
        if ("error" in result) {
          const failed: AiMetricsSourceReport = {
            id: `${peer.hostId}:peer`,
            kind: "hub-host",
            label: `${peer.hostId} · Peer`,
            url: peer.url,
            status: { ok: false, error: result.error },
            lastSampleAt: null,
            fields: [],
          };
          return [failed];
        }
        return prefixSources(peer.hostId, result.sources);
      }),
    );

    return {
      ...local,
      generatedAt: new Date().toISOString(),
      sources: [...local.sources, ...peerParts.flat()],
    };
  });
}
