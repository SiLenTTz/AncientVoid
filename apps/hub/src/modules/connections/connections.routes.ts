import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { EndpointEntryInput, VoidWardenConnectionInput, CONNECTIONS_MAX_ENDPOINTS, CONNECTIONS_MAX_VOIDWARDEN } from "@ancientvoid/contracts";
import { ConnectionStore, probeEndpoint, type StoredEndpoint, type StoredVoidWarden } from "@ancientvoid/core";
import type { RouteContext } from "../../route-context.ts";

/**
 * Verbindungs-Registry (Optionsbereich der PWA): VoidWarden-Instanzen und
 * Modell-/Tool-Endpoints. Ganzes Modul ist eine Menschenfläche — die Policy
 * mappt /api/connections auf settings.manage (Muster Vault, ADR-0063 §4).
 * VoidWarden bekommt pro Eintrag ein eigenes read-only-Token (`agent:vw-…`),
 * einmalig sichtbar bei Anlegen/Erneuern — gespeichert wird nur der Hash
 * (TokenService). Endpoint-Schlüssel liegen nur als Hash im ConnectionStore
 * und werden nie zurückgegeben.
 */
export function registerConnectionRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { deps } = ctx;
  if (!deps.settings) {
    for (const [method, path] of [
      ["GET", "/api/connections"],
      ["POST", "/api/connections/voidwarden"],
      ["PUT", "/api/connections/voidwarden/:id"],
      ["DELETE", "/api/connections/voidwarden/:id"],
      ["POST", "/api/connections/endpoints"],
      ["PUT", "/api/connections/endpoints/:id"],
      ["DELETE", "/api/connections/endpoints/:id"],
      ["POST", "/api/connections/endpoints/:id/probe"],
    ] as const) {
      app.route({ method, url: path, handler: async (_req, reply) => reply.code(501).send({ error: "Verbindungen nicht konfiguriert (keine Persistenz am Hub)" }) });
    }
    return;
  }

  const store = new ConnectionStore(deps.settings);
  /** Frisch aus der Token-Tabelle — last_used_at ändert sich mit jeder VoidWarden-Meldung. */
  const lastSeenOf = (label: string): string | null => deps.tokens.list().find((t) => t.label === label)?.lastUsedAt ?? null;
  /** Eigenes read-only-Token pro Verbindung (actorKind „agent“: lesen ja, lenken nein). */
  const issueVoidWardenToken = (): { label: string; token: string } => {
    const label = `agent:vw-${randomUUID().slice(0, 8)}`;
    return { label, token: deps.tokens.issue(label).token };
  };

  const voidWardenView = (e: StoredVoidWarden) => ({
    id: e.id,
    name: e.name,
    ...(e.endpoint ? { endpoint: e.endpoint } : {}),
    tokenLabel: e.tokenLabel,
    createdAt: e.createdAt,
    lastSeenAt: lastSeenOf(e.tokenLabel),
  });

  const endpointView = (e: StoredEndpoint) => ({
    id: e.id,
    name: e.name,
    kind: e.kind,
    baseUrl: e.baseUrl,
    hasKey: e.apiKeyHash !== null,
    models: e.models,
    createdAt: e.createdAt,
    probe: e.probe,
  });

  app.get("/api/connections", async () => ({ voidwarden: store.listVoidWarden().map(voidWardenView), endpoints: store.listEndpoints().map(endpointView) }));

  app.post("/api/connections/voidwarden", async (req, reply) => {
    const body = VoidWardenConnectionInput.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.issues[0]?.message ?? "ungültige Verbindung" });
    if (store.listVoidWarden().length >= CONNECTIONS_MAX_VOIDWARDEN) return reply.code(422).send({ error: `maximal ${CONNECTIONS_MAX_VOIDWARDEN} VoidWarden-Verbindungen` });
    const issued = issueVoidWardenToken();
    const entry = store.addVoidWarden(body.data, issued.label);
    return reply.code(201).send({ connection: voidWardenView(entry), token: issued.token });
  });

  const voidWardenId = (params: unknown) => z.string().uuid().safeParse((params as { id?: string }).id);

  app.put("/api/connections/voidwarden/:id", async (req, reply) => {
    const id = voidWardenId(req.params);
    if (!id.success) return reply.code(400).send({ error: "ungültige Id" });
    const body = VoidWardenConnectionInput.extend({ rotate: z.boolean().default(false) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.issues[0]?.message ?? "ungültige Verbindung" });
    const current = store.listVoidWarden().find((e) => e.id === id.data);
    if (!current) return reply.code(404).send({ error: "unbekannte Verbindung" });
    let token: string | undefined;
    if (body.data.rotate) {
      deps.tokens.revoke(current.tokenLabel);
      const issued = issueVoidWardenToken();
      token = issued.token;
      store.updateVoidWarden(id.data, body.data, issued.label);
    } else {
      store.updateVoidWarden(id.data, body.data);
    }
    const entry = store.listVoidWarden().find((e) => e.id === id.data);
    return { connection: voidWardenView(entry!), ...(token ? { token } : {}) };
  });

  app.delete("/api/connections/voidwarden/:id", async (req, reply) => {
    const id = voidWardenId(req.params);
    if (!id.success) return reply.code(400).send({ error: "ungültige Id" });
    const removed = store.removeVoidWarden(id.data);
    if (!removed) return reply.code(404).send({ error: "unbekannte Verbindung" });
    deps.tokens.revoke(removed.tokenLabel);
    return { ok: true };
  });

  app.post("/api/connections/endpoints", async (req, reply) => {
    const body = EndpointEntryInput.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.issues[0]?.message ?? "ungültiger Endpoint" });
    if (store.listEndpoints().length >= CONNECTIONS_MAX_ENDPOINTS) return reply.code(422).send({ error: `maximal ${CONNECTIONS_MAX_ENDPOINTS} Endpoints` });
    return reply.code(201).send({ endpoint: endpointView(store.addEndpoint(body.data)) });
  });

  const endpointId = (params: unknown) => z.string().uuid().safeParse((params as { id?: string }).id);

  app.put("/api/connections/endpoints/:id", async (req, reply) => {
    const id = endpointId(req.params);
    if (!id.success) return reply.code(400).send({ error: "ungültige Id" });
    const body = EndpointEntryInput.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.issues[0]?.message ?? "ungültiger Endpoint" });
    const updated = store.updateEndpoint(id.data, body.data);
    if (!updated) return reply.code(404).send({ error: "unbekannter Endpoint" });
    return { endpoint: endpointView(updated) };
  });

  app.delete("/api/connections/endpoints/:id", async (req, reply) => {
    const id = endpointId(req.params);
    if (!id.success) return reply.code(400).send({ error: "ungültige Id" });
    return store.removeEndpoint(id.data) ? { ok: true } : reply.code(404).send({ error: "unbekannter Endpoint" });
  });

  app.post("/api/connections/endpoints/:id/probe", async (req, reply) => {
    const id = endpointId(req.params);
    if (!id.success) return reply.code(400).send({ error: "ungültige Id" });
    const entry = store.listEndpoints().find((e) => e.id === id.data);
    if (!entry) return reply.code(404).send({ error: "unbekannter Endpoint" });
    const probe = await probeEndpoint(entry.baseUrl);
    return { endpoint: endpointView(store.recordProbe(id.data, probe)!) };
  });
}
