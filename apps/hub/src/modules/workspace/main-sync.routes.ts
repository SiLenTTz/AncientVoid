import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { MainSyncProjectOverride, MainSyncSettings, mainSyncSettingsPath } from "@ancientvoid/contracts";
import type { RouteContext } from "../../route-context.ts";

const PutBody = z
  .object({
    /** Globale Einstellungen (vollständig — Teilupdates gäben einen Mischzustand, den keiner gemeint hat). */
    global: MainSyncSettings,
    /** Projekt-Overrides als ganze Map (idempotent, kein Patch-Protokoll nötig). */
    projects: z.record(z.string().min(1), MainSyncProjectOverride),
  })
  .strict();

/**
 * EPIC-P67 T67.3: `GET/PUT /api/settings/main-sync` (ADR-0088 §5). Die Route
 * liegt unter `/api/settings` und fällt damit unter die Policy `settings.manage`
 * (Agenten/Displays/Fleet: deny). Ohne Settings-Dep → 501, wie die PWA-Push-
 * und Vault-Routen es bei fehlender Dep auch tun.
 */
export function registerMainSyncSettingsRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { deps } = ctx;

  app.get(mainSyncSettingsPath, async (_req, reply) => {
    const mainSync = deps.mainSync;
    if (!mainSync) return reply.code(501).send({ error: "settings not configured" });
    return { global: mainSync.global(), projects: mainSync.overrides() };
  });

  app.put(mainSyncSettingsPath, async (req, reply) => {
    const mainSync = deps.mainSync;
    if (!mainSync) return reply.code(501).send({ error: "settings not configured" });
    const body = PutBody.safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: "invalid main-sync settings", issues: body.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) });
    }
    mainSync.setGlobal(body.data.global);
    mainSync.setOverrides(body.data.projects);
    return { global: mainSync.global(), projects: mainSync.overrides() };
  });
}
