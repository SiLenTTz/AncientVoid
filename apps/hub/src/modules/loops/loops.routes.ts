import type { FastifyInstance } from "fastify";
import type { LoopInfo } from "@uacc/contracts";
import type { RouteContext } from "../../route-context.ts";

/** EPIC-P19: welche Loops es gibt und ob sie startbar sind. Keine Secrets, nur Fähigkeiten und Gründe. */
export function registerLoopsRoutes(app: FastifyInstance, ctx: RouteContext): void {
  app.get("/api/loops", async (): Promise<LoopInfo[]> => ctx.loops.list());
}
