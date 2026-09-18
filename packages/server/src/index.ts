import Fastify, { type FastifyInstance } from "fastify";
import fastifyWebsocket from "@fastify/websocket";
import fastifyStatic from "@fastify/static";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { SessionManager, TokenService, AdapterRegistry, ApprovalService } from "@uacc/core";
import { discoverProjects } from "@uacc/core";
import { authHook, type AuthOptions } from "./auth.ts";
import { registerRoutes } from "./routes.ts";
import { registerWs } from "./ws.ts";

export interface HubAppDeps {
  sessions: SessionManager;
  tokens: TokenService;
  registry: AdapterRegistry;
  auth: AuthOptions;
  pwaDir?: string;
  /** T1.5-4: host paths to scan for git repos, offered as session projects. */
  projectRoots?: string[];
  /** T2.4: optional, mirrors SessionManager's own optional approvals —
   * omitting it disables the /api/approvals routes (501), not a crash. */
  approvals?: ApprovalService;
}

export async function createHubApp(deps: HubAppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: process.env.UACC_LOG ?? "info" },
  });
  await app.register(fastifyWebsocket);

  app.addHook("onRequest", authHook(deps.auth));

  const projectRoots = deps.projectRoots ?? [];
  if (projectRoots.length > 0) {
    // BUG-0009's lesson applied here too: a misconfigured root must not
    // silently degrade to an empty project list — warn at startup, once,
    // with the exact path that failed.
    const { warnings } = await discoverProjects(projectRoots);
    for (const w of warnings) app.log.warn(w);
  }
  registerRoutes(app, { ...deps, projectRoots });
  registerWs(app, deps.sessions);

  if (deps.pwaDir) {
    const resolvedPwaDir = resolve(deps.pwaDir);
    if (existsSync(resolvedPwaDir)) {
      await app.register(fastifyStatic, {
        root: resolvedPwaDir,
        prefix: "/",
        decorateReply: true,
      });
      app.setNotFoundHandler(async (req, reply) => {
        if (req.url.startsWith("/api/")) {
          return reply.code(404).send({ error: "not found" });
        }
        return reply.sendFile("index.html");
      });
    } else {
      // BUG-0009: this used to fail silently — configured but resolved to
      // a directory that doesn't exist (e.g. a relative pwaDir combined
      // with a different CWD than whoever wrote the config assumed), and
      // every non-/api/ request just got a bare 404 with no clue why.
      app.log.warn(
        `pwaDir "${deps.pwaDir}" resolved to "${resolvedPwaDir}", which does not exist — ` +
          "the PWA will not be served (only /api/* routes are registered). " +
          "Check hub.config.json's pwaDir is relative to the directory main.ts is run from.",
      );
    }
  }

  return app;
}

export { WS_PROTOCOL_VERSION } from "@uacc/contracts";
