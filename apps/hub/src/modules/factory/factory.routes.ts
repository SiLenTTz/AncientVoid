import type { FastifyInstance } from "fastify";
import { LOOP_ARG, loopAdapterId } from "@ancientvoid/contracts";
import { isProjectPathAllowed, toStartSpec } from "@ancientvoid/core";
import type { RouteContext } from "../../route-context.ts";

const FACTORY_LOOP = "securesight-factory";
/** ADR-0043 3.1: nur `claude` treibt — der projektlokale /factory-Skill ist eine Claude-Konvention (P25-Befund). */
const DRIVER_ADAPTER = "claude";

/**
 * EPIC-P26 T26.5 / ADR-0043: ein Factory-Lauf beginnt mit zwei verknüpften
 * Sessions — Treiber (Claude im Projektverzeichnis, erster Prompt `/factory`)
 * und Beobachter (Loop securesight-factory, Modus `project`, schreibt nichts).
 * Verknüpfung: `options.driver` im Loop-Snapshot (K7) plus `factory.linkage`-
 * Ereignis auf beiden Sessions. Scheitert der Beobachter, wird der Treiber
 * wieder beendet — kein halbgareller Lauf. Policy `factory.start`: nur Menschen.
 */
export function registerFactoryRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { deps, hostId, projectRoots, catalogRootFor, callerLabel } = ctx;

  app.post<{ Body: { project?: unknown; goal?: unknown } }>("/api/factory/start", async (req, reply) => {
    const { project, goal } = req.body ?? {};
    if (typeof project !== "string" || !project.trim()) return reply.code(400).send({ error: "project fehlt" });
    if (goal !== undefined && typeof goal !== "string") return reply.code(400).send({ error: "goal muss Text sein" });
    if (!(await isProjectPathAllowed(project, projectRoots))) {
      return reply.code(422).send({ error: "project path is outside the configured projectRoots" });
    }
    const loopSpec = { id: FACTORY_LOOP, options: { anbindung: "bestehend" } };
    try {
      ctx.loops.assertStartable(loopSpec);
    } catch (err) {
      return reply.code(422).send({ error: err instanceof Error ? err.message : "loop not startable" });
    }
    const actor = callerLabel(req) ?? undefined;
    await catalogRootFor(project);
    try {
      // 1. Treiber — normaler Prompt-Weg, kein Sonderkanal (ADR-0043 1.).
      const driver = await deps.sessions.create(
        { adapter: DRIVER_ADAPTER, project, prompt: goal?.trim() ? `/factory ${goal.trim()}` : "/factory" },
        actor,
      );
      try {
        // 2. Beobachter — Verknüpfung in options.driver, damit sie im Loop-Snapshot überlebt (K7).
        const observer = await deps.sessions.create(
          {
            adapter: loopAdapterId(FACTORY_LOOP),
            project,
            args: { [LOOP_ARG]: toStartSpec({ ...loopSpec, options: { ...loopSpec.options, driver: driver.id } }, { project, goal }) },
          },
          actor,
        );
        // 3. Verknüpfung sichtbar machen — auf beiden Sessions, aus JSONL rekonstruierbar.
        await Promise.all([
          deps.sessions.recordHubEvents(driver.id, [
            { type: "system", summary: `Factory-Lauf: Treiber, Beobachter ${observer.id}`, payload: { kind: "factory.linkage", factory: { role: "driver", partner: observer.id } } },
          ]),
          deps.sessions.recordHubEvents(observer.id, [
            { type: "system", summary: `Factory-Lauf: Beobachter, Treiber ${driver.id}`, payload: { kind: "factory.linkage", factory: { role: "observer", partner: driver.id } } },
          ]),
        ]);
        return reply.code(201).send({ driver, observer, hostId });
      } catch (err) {
        await deps.sessions.steer(driver.id, { kind: "stop" }, actor).catch(() => undefined);
        return reply.code(422).send({ error: `Beobachter konnte nicht angelegt werden: ${err instanceof Error ? err.message : String(err)}` });
      }
    } catch (err) {
      return reply.code(422).send({ error: err instanceof Error ? err.message : "factory start failed" });
    }
  });
}
