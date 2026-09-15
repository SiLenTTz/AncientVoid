import Fastify, { type FastifyInstance } from "fastify";
import fastifyWebsocket from "@fastify/websocket";
import fastifyStatic from "@fastify/static";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { SessionManager, TokenService, AdapterRegistry } from "@uacc/core";
import { authHook, type AuthOptions } from "./auth.ts";
import { registerRoutes } from "./routes.ts";
import { registerWs } from "./ws.ts";

export interface HubAppDeps {
  sessions: SessionManager;
  tokens: TokenService;
  registry: AdapterRegistry;
  auth: AuthOptions;
  pwaDir?: string;
}

export async function createHubApp(deps: HubAppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: process.env.UACC_LOG ?? "info" },
  });
  await app.register(fastifyWebsocket);

  app.addHook("onRequest", authHook(deps.auth));

  registerRoutes(app, deps);
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
