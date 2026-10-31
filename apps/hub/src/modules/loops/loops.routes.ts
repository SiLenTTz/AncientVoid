import type { FastifyInstance } from "fastify";
import type { LoopInfo, LoopOnboardResult } from "@ancientvoid/contracts";
import type { RouteContext } from "../../route-context.ts";

const ONBOARD_TIMEOUT_MS = 180_000;

/** EPIC-P19: welche Loops es gibt und ob sie startbar sind. Keine Secrets, nur Fähigkeiten und Gründe. */
export function registerLoopsRoutes(app: FastifyInstance, ctx: RouteContext): void {
  app.get("/api/loops", async (): Promise<LoopInfo[]> => ctx.loops.list());

  // Ein Onboarding gleichzeitig: es startet Container auf dem Host. Das Geheimnis liegt nur in diesem Aufruf.
  let busy = false;
  app.post<{ Params: { id: string }; Body: { options?: Record<string, string>; secret?: string } }>("/api/loops/:id/onboard", async (req, reply): Promise<LoopOnboardResult> => {
    const connector = ctx.loops.connector(req.params.id);
    const onboarding = connector?.capabilities().onboarding;
    if (!connector?.onboard || !onboarding) {
      reply.code(404);
      return { ok: false, detail: "Dieser Loop braucht keine Einrichtung pro Repo" };
    }
    const { options, secret } = req.body ?? {};
    if (typeof options !== "object" || options === null || (onboarding.secret && (typeof secret !== "string" || !secret.trim()))) {
      reply.code(400);
      return { ok: false, detail: onboarding.secret ? `${onboarding.secret.label} fehlt` : "Angaben fehlen" };
    }
    if (busy) {
      reply.code(409);
      return { ok: false, detail: "Es läuft schon eine Einrichtung" };
    }
    busy = true;
    try {
      const result = await connector.onboard({ options, ...(secret === undefined ? {} : { secret }) }, AbortSignal.timeout(ONBOARD_TIMEOUT_MS));
      if (!result.ok) reply.code(422);
      return result;
    } finally {
      busy = false;
    }
  });
}
