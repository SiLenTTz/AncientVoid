import type { FastifyInstance } from "fastify";
import { createRouteContext, type RouteDeps } from "./route-context.ts";
import { registerSystemRoutes } from "./modules/system/system.routes.ts";
import { registerHarnessRoutes } from "./modules/harness/harness.routes.ts";
import { registerPromptsRoutes } from "./modules/prompts/prompts.routes.ts";
import { registerWorkspaceRoutes } from "./modules/workspace/workspace.routes.ts";
import { registerProjectCreateRoute } from "./modules/workspace/project-create.routes.ts";
import { registerSessionsRoutes } from "./modules/sessions/sessions.routes.ts";
import { registerDiscoveryRoutes } from "./modules/discovery/discovery.routes.ts";
import { registerHandoverRoutes } from "./modules/sessions/handover.routes.ts";
import { registerRunsRoutes } from "./modules/runs/runs.routes.ts";
import { registerNotificationsRoutes } from "./modules/notifications/notifications.routes.ts";
import { registerIdentityRoutes } from "./modules/identity/identity.routes.ts";
import { registerApprovalsRoutes } from "./modules/approvals/approvals.routes.ts";
import { registerSearchRoutes } from "./modules/search/search.routes.ts";
import { registerCodeRoutes } from "./modules/code/code.routes.ts";
import { registerLoopsRoutes } from "./modules/loops/loops.routes.ts";
import { registerFactoryRoutes } from "./modules/factory/factory.routes.ts";
import { registerCommandRoutes } from "./modules/commands/commands.routes.ts";

/** Composition of every module's HTTP routes (ADR-0020). */
export function registerRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const ctx = createRouteContext(deps);
  registerSystemRoutes(app, ctx);
  registerHarnessRoutes(app, ctx);
  registerPromptsRoutes(app, ctx);
  registerWorkspaceRoutes(app, ctx);
  registerProjectCreateRoute(app, ctx);
  registerSessionsRoutes(app, ctx);
  registerDiscoveryRoutes(app, ctx);
  registerNotificationsRoutes(app, ctx);
  registerRunsRoutes(app, ctx);
  registerHandoverRoutes(app, ctx);
  registerIdentityRoutes(app, ctx);
  registerApprovalsRoutes(app, ctx);
  registerSearchRoutes(app, ctx);
  registerCodeRoutes(app, ctx);
  registerLoopsRoutes(app, ctx);
  registerFactoryRoutes(app, ctx);
  registerCommandRoutes(app, ctx, deps.assistantModel ? { model: deps.assistantModel } : {});
}
