import type { FastifyInstance } from "fastify";
import { createProject } from "@uacc/core";
import { spawn } from "node:child_process";
import type { RouteContext } from "../../route-context.ts";

/** T-PJ1: POST /api/projects — create a project (git init) in the first projectRoot. */
export function registerProjectCreateRoute(app: FastifyInstance, ctx: RouteContext): void {
  const { projectRoots } = ctx;

  app.post("/api/projects", async (req, reply) => {
    const name = typeof (req.body as { name?: unknown })?.name === "string" ? (req.body as { name: string }).name.trim() : "";
    if (!name) return reply.code(400).send({ error: "name (string) erforderlich" });
    const git = (args: string[], cwd: string) =>
      new Promise<{ code: number; stderr: string }>((resolve) => {
        const child = spawn("git", args, { cwd });
        let stderr = "";
        child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
        child.on("error", (err) => resolve({ code: -1, stderr: err.message }));
        child.on("close", (code) => resolve({ code: code ?? -1, stderr }));
      });
    try {
      const result = await createProject(projectRoots, name, { git });
      return { ok: true, created: result.created, project: result.project };
    } catch (err) {
      return reply.code(422).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });
}
