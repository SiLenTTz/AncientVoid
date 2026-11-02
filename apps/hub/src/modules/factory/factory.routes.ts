import { realpath } from "node:fs/promises";
import type { FastifyInstance } from "fastify";
import { LOOP_ARG, loopAdapterId } from "@ancientvoid/contracts";
import { isProjectPathAllowed, toStartSpec, resolveSkillChain } from "@ancientvoid/core";
import type { RouteContext } from "../../route-context.ts";

const FACTORY_LOOP = "securesight-factory";
/** Rückwärtskompatibler Standard; maki bekommt den Skill als Prompt statt als Slash. */
const DRIVER_ADAPTER = "claude";

/**
 * EPIC-P26 T26.5 / ADR-0043: ein Factory-Lauf beginnt mit zwei verknüpften
 * Sessions — Treiber (Claude/maki im Projektverzeichnis, Factory-Skill)
 * und Beobachter (Loop securesight-factory, Modus `project`, schreibt nichts).
 * Verknüpfung: `options.driver` im Loop-Snapshot (K7) plus `factory.linkage`-
 * Ereignis auf beiden Sessions. Scheitert der Beobachter, wird der Treiber
 * wieder beendet — kein halbgareller Lauf. Policy `factory.start`: nur Menschen.
 */
export function registerFactoryRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const starting = new Set<string>();
  const { deps, hostId, projectRoots, catalogRootFor, callerLabel } = ctx;

  app.post<{ Body: { project?: unknown; goal?: unknown; adapter?: unknown; model?: unknown } }>("/api/factory/start", async (req, reply) => {
    const { project, goal, adapter = DRIVER_ADAPTER, model } = req.body ?? {};
    if (adapter !== "claude" && adapter !== "maki") return reply.code(400).send({ error: "Factory-Treiber muss claude oder maki sein" });
    if (model !== undefined && (typeof model !== "string" || !model.trim())) return reply.code(400).send({ error: "model muss Text sein" });
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
    const root = await realpath(project);
    const active = deps.sessions.list().find((s) => s.project === root && s.adapter === loopAdapterId(FACTORY_LOOP) && !["stopped", "error", "interrupted"].includes(s.status));
    if (starting.has(root) || active) return reply.code(409).send({ error: "Für dieses Projekt läuft bereits eine Factory. Öffne den bestehenden Lauf.", ...(active ? { observerId: active.id } : {}) });
    starting.add(root);
    try {
      const actor = callerLabel(req) ?? undefined;
      await catalogRootFor(root);
      try {
        // 1. Treiber — normaler Prompt-Weg, kein Sonderkanal (ADR-0043 1.).
        const command = goal?.trim() ? `/factory ${goal.trim()}` : "/factory";
        const skill = adapter === "maki" ? await resolveSkillChain(root, "factory") : null;
        if (adapter === "maki" && !skill) return reply.code(422).send({ error: "Factory-Skill fehlt im Projekt; zuerst factory init ausführen" });
        const driver = await deps.sessions.create(
          { adapter, project: root, prompt: command, ...(skill ? { args: { skill: "factory" } } : {}), ...(model ? { model } : {}) },
          actor,
          { workInProject: true },
        );
        const label = (goal?.trim().split("\n")[0] || root.split("/").pop() || "Lauf");
        deps.sessions.setMeta(driver.id, { title: `Factory · ${label}`.slice(0, 120) });
        try {
          // 2. Beobachter — Verknüpfung in options.driver, damit sie im Loop-Snapshot überlebt (K7).
          const observer = await deps.sessions.create(
            {
              adapter: loopAdapterId(FACTORY_LOOP),
              project: root,
              title: `Factory-Beobachter · ${label}`.slice(0, 120),
              args: { [LOOP_ARG]: toStartSpec({ ...loopSpec, options: { ...loopSpec.options, driver: driver.id } }, { project: root, goal }) },
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
          return reply.code(201).send({ driver: { ...deps.sessions.get(driver.id), hostId }, observer: { ...observer, hostId }, hostId });
        } catch (err) {
          await deps.sessions.steer(driver.id, { kind: "stop" }, actor).catch(() => undefined);
          return reply.code(422).send({ error: `Beobachter konnte nicht angelegt werden: ${err instanceof Error ? err.message : String(err)}` });
        }
      } catch (err) {
        return reply.code(422).send({ error: err instanceof Error ? err.message : "factory start failed" });
      }
    } finally {
      starting.delete(root);
    }
  });
}
