import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { KNOWLEDGE_MAX_SOURCES, KnowledgeQuery, KnowledgeSourceInput } from "@ancientvoid/contracts";
import { KnowledgeService, type KnowledgeCall } from "@ancientvoid/core";
import type { RouteContext } from "../../route-context.ts";

/**
 * EPIC-P74 T74.6a (ADR-0096): Wissensquellen anbinden und befragen. Ganze
 * Fläche ist settings.manage (Menschen; Agenten deny, Muster Vault/Verbindungen).
 * Treffer und Dokumente gehen nur als Daten an die Oberfläche (PRD §8.5);
 * jeder Fehlschlag antwortet 502 mit dem neuen Status der Quelle (Fail loud).
 */
export function registerKnowledgeRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { deps } = ctx;
  const service = deps.knowledge ?? (deps.settings ? new KnowledgeService(deps.settings) : null);
  if (!service) {
    app.all("/api/knowledge/*", async (_req, reply) => reply.code(501).send({ error: "Wissensquellen nicht konfiguriert (keine Persistenz am Hub)" }));
    return;
  }

  const sourceId = (params: unknown) => z.string().uuid().safeParse((params as { id?: string }).id);
  const firstIssue = (err: z.ZodError, fallback: string) => {
    const issue = err.issues[0];
    return issue ? `${issue.path.join(".") || fallback}: ${issue.message}` : fallback;
  };
  const answer = <T>(reply: FastifyReply, res: KnowledgeCall<T> | null) => {
    if (!res) return reply.code(404).send({ error: "unbekannte Quelle" });
    if (!res.ok) return reply.code(502).send({ error: res.error, source: res.source });
    const { ok: _ok, ...body } = res;
    return body;
  };

  app.get("/api/knowledge/sources", async () => ({ sources: service.list() }));

  app.post("/api/knowledge/sources", async (req, reply) => {
    const body = KnowledgeSourceInput.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: firstIssue(body.error, "Quelle") });
    const source = service.add(body.data);
    if (!source) return reply.code(422).send({ error: `maximal ${KNOWLEDGE_MAX_SOURCES} Wissensquellen` });
    return reply.code(201).send({ source });
  });

  app.put("/api/knowledge/sources/:id", async (req, reply) => {
    const id = sourceId(req.params);
    if (!id.success) return reply.code(400).send({ error: "ungültige Id" });
    const body = KnowledgeSourceInput.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: firstIssue(body.error, "Quelle") });
    const res = service.update(id.data, body.data);
    if (!res) return reply.code(404).send({ error: "unbekannte Quelle" });
    if ("error" in res) return reply.code(422).send(res);
    return res;
  });

  app.delete("/api/knowledge/sources/:id", async (req, reply) => {
    const id = sourceId(req.params);
    if (!id.success) return reply.code(400).send({ error: "ungültige Id" });
    return service.remove(id.data) ? { ok: true } : reply.code(404).send({ error: "unbekannte Quelle" });
  });

  app.post("/api/knowledge/sources/:id/probe", async (req, reply) => {
    const id = sourceId(req.params);
    if (!id.success) return reply.code(400).send({ error: "ungültige Id" });
    return answer(reply, await service.probe(id.data));
  });

  app.post("/api/knowledge/sources/:id/search", async (req, reply) => {
    const id = sourceId(req.params);
    if (!id.success) return reply.code(400).send({ error: "ungültige Id" });
    const query = KnowledgeQuery.safeParse(req.body);
    if (!query.success) return reply.code(400).send({ error: firstIssue(query.error, "Suche") });
    return answer(reply, await service.search(id.data, query.data));
  });

  app.post("/api/knowledge/sources/:id/read", async (req, reply) => {
    const id = sourceId(req.params);
    if (!id.success) return reply.code(400).send({ error: "ungültige Id" });
    const body = z.object({ ref: z.string().min(1).max(1000) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: firstIssue(body.error, "ref") });
    return answer(reply, await service.read(id.data, body.data.ref));
  });
}
