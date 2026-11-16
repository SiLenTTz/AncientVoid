import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { homedir } from "node:os";
import { z } from "zod";
import { VaultError, VaultStore, type VaultStoreIo } from "@ancientvoid/core";
import type { RouteContext } from "../../route-context.ts";

/**
 * EPIC-P49 (ADR-0063): Knowledge Vault — Notizen des Menschen in einem gewählten Ordner.
 * Alle Routen lehnen Agenten ab (Menschenfläche wie die Diagnose-Freigabe); die
 * Root-Wahl braucht zusätzlich `settings.manage`. Pfade erscheinen nie in Events.
 */
export function registerVaultRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { deps, projectRoots, callerLabel } = ctx;
  if (!deps.settings) {
    for (const path of ["/api/vault/state", "/api/vault/browse", "/api/vault/root", "/api/vault/files", "/api/vault/file"]) {
      app.get(path, async (_req, reply) => reply.code(501).send({ error: "Der Vault braucht den Einstellungs-Speicher (SettingsStore)." }));
      app.post(path, async (_req, reply) => reply.code(501).send({ error: "Der Vault braucht den Einstellungs-Speicher (SettingsStore)." }));
      app.put(path, async (_req, reply) => reply.code(501).send({ error: "Der Vault braucht den Einstellungs-Speicher (SettingsStore)." }));
    }
    return;
  }
  const io: VaultStoreIo = {
    getRoot: () => deps.settings!.get("vault.root"),
    setRoot: (path) => deps.settings!.set("vault.root", path),
    browseRoots: () => [...(projectRoots ?? []), homedir()],
    forbiddenRoot: () => deps.dataDir ?? null,
  };
  const vault = new VaultStore(io);

  const refuseAgents = (req: FastifyRequest, reply: FastifyReply): boolean => {
    // Zentral lehnt die Policy (settings.manage, agent→deny) Agenten längst ab;
    // dieser Check bleibt als zweite Wand für künftige Operationen-Umzüge.
    if (req.policy?.decision === "deny") {
      reply.code(403).send({ error: "Der Knowledge Vault ist eine Menschenfläche." });
      return true;
    }
    return false;
  };
  const fail = (reply: FastifyReply, err: unknown): FastifyReply => {
    if (err instanceof VaultError) return reply.code(err.status).send({ error: err.message });
    return reply.code(500).send({ error: err instanceof Error ? err.message : "Vault-Fehler" });
  };

  app.get("/api/vault/state", async (req, reply) => {
    if (refuseAgents(req, reply)) return;
    return vault.state();
  });

  app.get("/api/vault/browse", async (req, reply) => {
    if (refuseAgents(req, reply)) return;
    const q = req.query as { path?: string };
    try {
      return await vault.browse(q.path ?? null);
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.put("/api/vault/root", async (req, reply) => {
    if (refuseAgents(req, reply)) return;
    if (req.policy?.decision !== "allow" || !callerLabel(req)) {
      // Capability settings.manage steckt in der Policy-Zuordnung; ohne ausdrückliche
      // allow-Entscheidung (Mensch am Gerät) wird die Root-Wahl verweigert.
      return reply.code(403).send({ error: "Die Vault-Ordnerwahl braucht Einstellungsrechte." });
    }
    const body = z.object({ path: z.string().min(1).max(1024) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "path required" });
    try {
      return await vault.setRoot(body.data.path);
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.get("/api/vault/files", async (req, reply) => {
    if (refuseAgents(req, reply)) return;
    try {
      return await vault.list();
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.post("/api/vault/files", async (req, reply) => {
    if (refuseAgents(req, reply)) return;
    const body = z.object({ name: z.string().min(1).max(200) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "name required" });
    try {
      return reply.code(201).send(await vault.create(body.data.name));
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.get("/api/vault/file", async (req, reply) => {
    if (refuseAgents(req, reply)) return;
    const q = req.query as { path?: string };
    if (!q.path) return reply.code(400).send({ error: "path required" });
    try {
      return await vault.read(q.path);
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.put("/api/vault/file", async (req, reply) => {
    if (refuseAgents(req, reply)) return;
    const q = req.query as { path?: string; rev?: string };
    const body = z.object({ text: z.string().max(1024 * 1024) }).safeParse(req.body);
    if (!q.path || !q.rev) return reply.code(400).send({ error: "path and rev required" });
    if (!body.success) return reply.code(400).send({ error: "text required (max 1 MiB)" });
    try {
      return await vault.write(q.path, body.data.text, q.rev);
    } catch (err) {
      return fail(reply, err);
    }
  });
}
