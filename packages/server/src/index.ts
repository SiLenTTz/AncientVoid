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

  if (deps.pwaDir && existsSync(resolve(deps.pwaDir))) {
    await app.register(fastifyStatic, {
      root: resolve(deps.pwaDir),
      prefix: "/",
      decorateReply: true,
    });
    app.setNotFoundHandler(async (req, reply) => {
      if (req.url.startsWith("/api/")) {
        return reply.code(404).send({ error: "not found" });
      }
      return reply.sendFile("index.html");
    });
  }

  return app;
}

export { WS_PROTOCOL_VERSION } from "@uacc/contracts";
