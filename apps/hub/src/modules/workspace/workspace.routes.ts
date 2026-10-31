import type { FastifyInstance } from "fastify";
import { discoverProjects } from "@ancientvoid/core";
import type { RouteContext } from "../../route-context.ts";

/** Project discovery under the configured roots (T1.5-4). */
export function registerWorkspaceRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { projectRoots } = ctx;

  app.get("/api/projects", async () => {
    // T1.5-4: fresh scan on every call (not cached at startup) — a repo
    // cloned after the hub started should show up without a restart.
    // Startup-time readability warnings are logged once in createHubApp();
    // this response carries them again so a client can surface them too.
    const { projects, warnings } = await discoverProjects(projectRoots);
    return { projects, warnings };
  });
}
