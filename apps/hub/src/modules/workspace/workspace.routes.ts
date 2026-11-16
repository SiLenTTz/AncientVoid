import type { FastifyInstance } from "fastify";
import { discoverProjects } from "@ancientvoid/core";
import type { RouteContext } from "../../route-context.ts";
import { registerWorkspaceProxyRoutes } from "./workspace-proxy.ts";

export function registerWorkspaceRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { projectRoots, deps } = ctx;

  app.get("/api/projects", async () => {
    // T1.5-4: fresh scan on every call (not cached at startup) — a repo
    // cloned after the hub started should show up without a restart.
    // Startup-time readability warnings are logged once in createHubApp();
    // this response carries them again so a client can surface them too.
    const { projects, warnings } = await discoverProjects(projectRoots);
    // BUG-0163: „keine Projekte" ist zwei verschiedene Lagen — Wurzeln gar nicht
    // gesetzt, oder Wurzeln gesetzt aber kein Git-Repo darin. Das Interface darf
    // daraus keine Sackgasse bauen.
    return { projects, warnings, rootsConfigured: projectRoots.length > 0, roots: projectRoots };
  });

  // EPIC-P29 T29.6: Workspace-Status/Logs/Retry — die K7-Projektion aus
  // workspaceStatus() (Faltung + Service-Zeilen), serviert über den Vertrag.
  app.get("/api/sessions/:id/workspace", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!deps.sessions.get(id)) return reply.code(404).send({ error: "unknown session" });
    const status = await deps.sessions.workspaceStatus(id);
    if (!status) return reply.code(404).send({ error: "kein Workspace für diese Session (Migrationsregel, ADR-0051 §7)" });
    return status;
  });

  app.get("/api/sessions/:id/workspace/services/:serviceId/logs", async (req, reply) => {
    const { id, serviceId } = req.params as { id: string; serviceId: string };
    if (!deps.sessions.get(id)) return reply.code(404).send({ error: "unknown session" });
    const logs = await deps.sessions.workspaceServiceLogs(id, serviceId);
    if (!logs) return reply.code(404).send({ error: "unbekannter Service" });
    return reply.header("cache-control", "no-store").send(logs);
  });

  // ADR-0051 §3: Retry ist die Entscheidung eines Menschen — die Policy-
  // Tabelle (workspace.retry) hat Agenten/Displays/Fleet schon vorher 403.
  app.post("/api/sessions/:id/workspace/retry", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!deps.sessions.get(id)) return reply.code(404).send({ error: "unknown session" });
    const ack = await deps.sessions.retryWorkspaceSetup(id, ctx.callerLabel(req) ?? undefined);
    return ack.ok ? reply.header("cache-control", "no-store").send(ack) : reply.code(422).send(ack);
  });

  registerWorkspaceProxyRoutes(app, ctx);
}
