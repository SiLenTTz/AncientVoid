import { readFileSync } from "node:fs";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { BrowserAction, BrowserFeedbackInput, BrowserTestCase } from "@ancientvoid/contracts";
import { BrowserError, composeBrowserFeedback } from "@ancientvoid/core";
import type { RouteContext } from "../../route-context.ts";

/**
 * EPIC-P39 (ADR-0059): Browser-Arbeitsplatz je Session. Alles Schreibende ist Menschen-Eingabe: der Agent-Pfad
 * (Gateway-Entscheidung `approve`) bekommt 403 — Agenten nutzen den Browser nicht über diese Routen. Der Dienst ist
 * lokal (nicht in FLEET_ROUTABLE): Chromium läuft auf dem Host, dem die Session gehört.
 */
const HTTP: Record<string, number> = { unavailable: 503, quota: 429, blocked: 403, closed: 409, not_found: 404, busy: 409, failed: 502 };

export function registerBrowserRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { deps, callerLabel } = ctx;
  const browser = deps.browser;
  if (!browser) {
    app.get("/api/sessions/:id/browser", async (_req, reply) => reply.code(501).send({ error: "Der Browser-Arbeitsplatz ist auf diesem Hub nicht eingerichtet." }));
    return;
  }

  const humanOnly = (req: FastifyRequest, reply: FastifyReply): boolean => {
    if (req.policy?.decision === "approve") {
      void reply.code(403).send({ error: "Der Browser-Arbeitsplatz ist eine menschliche Bedienung." });
      return false;
    }
    return true;
  };
  const session = (req: FastifyRequest, reply: FastifyReply): string | null => {
    const { id } = req.params as { id: string };
    if (!deps.sessions.get(id)) {
      void reply.code(404).send({ error: "unknown session" });
      return null;
    }
    return id;
  };
  const fail = (reply: FastifyReply, err: unknown) => {
    if (err instanceof BrowserError) return reply.code(HTTP[err.code] ?? 500).send({ error: err.message, code: err.code });
    throw err;
  };

  app.get("/api/sessions/:id/browser", async (req, reply) => {
    const id = session(req, reply);
    if (!id) return;
    return browser.status(id);
  });

  app.post("/api/sessions/:id/browser/open", async (req, reply) => {
    if (!humanOnly(req, reply)) return;
    const id = session(req, reply);
    if (!id) return;
    const url = (req.body as { url?: unknown } | null)?.url;
    if (url !== undefined && (typeof url !== "string" || url.length > 2048)) return reply.code(400).send({ error: "url must be a string ≤ 2048" });
    try {
      return await browser.open(id, url);
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.post("/api/sessions/:id/browser/action", async (req, reply) => {
    if (!humanOnly(req, reply)) return;
    const id = session(req, reply);
    if (!id) return;
    const parsed = BrowserAction.safeParse((req.body as { action?: unknown } | null)?.action);
    if (!parsed.success) return reply.code(400).send({ error: "invalid action", issues: parsed.error.issues });
    try {
      return await browser.act(id, parsed.data);
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.post("/api/sessions/:id/browser/close", async (req, reply) => {
    if (!humanOnly(req, reply)) return;
    const id = session(req, reply);
    if (!id) return;
    await browser.close(id);
    return browser.status(id);
  });

  /** Standbild des Browsers — begrenzt in Rate und Größe, nie als Event. */
  app.get("/api/sessions/:id/browser/frame", async (req, reply) => {
    const id = session(req, reply);
    if (!id) return;
    const frame = await browser.frame(id);
    if (!frame) return reply.code(204).send();
    return reply.header("content-type", "image/jpeg").header("cache-control", "no-store").header("x-frame-seq", String(frame.seq)).send(frame.data);
  });

  app.get("/api/sessions/:id/browser/screenshot", async (req, reply) => {
    const id = session(req, reply);
    if (!id) return;
    const shot = await browser.screenshot(id);
    if (!shot) return reply.code(409).send({ error: "Der Browser ist nicht geöffnet." });
    return reply.header("content-type", "image/png").header("content-disposition", 'attachment; filename="browser.png"').header("cache-control", "no-store").send(shot);
  });

  // ---- Testläufe ------------------------------------------------------------------------------------------------
  app.get("/api/sessions/:id/browser/tests", async (req, reply) => {
    const id = session(req, reply);
    if (!id) return;
    return { runs: browser.listTests(id) };
  });

  app.post("/api/sessions/:id/browser/tests", async (req, reply) => {
    if (!humanOnly(req, reply)) return;
    const id = session(req, reply);
    if (!id) return;
    const parsed = BrowserTestCase.safeParse((req.body as { test?: unknown } | null)?.test);
    if (!parsed.success) return reply.code(400).send({ error: "invalid test case", issues: parsed.error.issues });
    try {
      return reply.code(202).send(await browser.runTest(id, parsed.data));
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.post("/api/sessions/:id/browser/tests/:runId/abort", async (req, reply) => {
    if (!humanOnly(req, reply)) return;
    const id = session(req, reply);
    if (!id) return;
    const { runId } = req.params as { runId: string };
    return browser.abortTest(id, runId) ? { ok: true } : reply.code(404).send({ error: "Kein laufender Test mit dieser ID." });
  });

  app.get("/api/sessions/:id/browser/tests/:runId/artifact", async (req, reply) => {
    const id = session(req, reply);
    if (!id) return;
    const { runId } = req.params as { runId: string };
    const file = browser.artifactPath(id, runId);
    if (!file) return reply.code(404).send({ error: "Kein Artefakt (Quota oder Lauf ohne Screenshot)." });
    return reply.header("content-type", "image/png").header("cache-control", "no-store").send(readFileSync(file));
  });

  // ---- Design-Auswahl und Feedback (über den Steer-Pfad, wie P36) -------------------------------------------------
  app.post("/api/sessions/:id/browser/pick", async (req, reply) => {
    if (!humanOnly(req, reply)) return;
    const id = session(req, reply);
    if (!id) return;
    const { x, y } = (req.body ?? {}) as { x?: unknown; y?: unknown };
    if (typeof x !== "number" || typeof y !== "number" || x < 0 || y < 0 || x > 10_000 || y > 10_000) return reply.code(400).send({ error: "x and y (0–10000) required" });
    try {
      return await browser.pick(id, x, y);
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.post("/api/sessions/:id/browser/feedback/preview", async (req, reply) => {
    if (!humanOnly(req, reply)) return;
    const id = session(req, reply);
    if (!id) return;
    const parsed = BrowserFeedbackInput.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid feedback input", issues: parsed.error.issues });
    const canAttach = Boolean(deps.attachments);
    return { prompt: composeBrowserFeedback(parsed.data.pick, parsed.data.note, parsed.data.includeScreenshot ? canAttach : null), screenshot: parsed.data.includeScreenshot && canAttach };
  });

  app.post("/api/sessions/:id/browser/feedback/send", async (req, reply) => {
    if (!humanOnly(req, reply)) return;
    const id = session(req, reply);
    if (!id) return;
    const parsed = BrowserFeedbackInput.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid feedback input", issues: parsed.error.issues });
    if (!parsed.data.operationId) return reply.code(400).send({ error: "operationId required" });
    const target = parsed.data.targetSessionId ?? id;
    if (!deps.sessions.get(target)) return reply.code(404).send({ ok: false, detail: "Empfänger-Session unbekannt" });

    let attachments: Awaited<ReturnType<NonNullable<typeof deps.attachments>["resolve"]>> | undefined;
    let attached: boolean | null = null;
    if (parsed.data.includeScreenshot && deps.attachments) {
      const area = parsed.data.pick.rect;
      const shot = await browser.screenshot(id, area);
      attached = Boolean(shot);
      if (shot) {
        const record = await deps.attachments.save(new Uint8Array(shot), "browser-element.png", "image/png");
        attachments = await deps.attachments.resolve([record.id]);
      }
    }
    const prompt = composeBrowserFeedback(parsed.data.pick, parsed.data.note, parsed.data.includeScreenshot ? attached ?? false : null);
    try {
      const ack = await deps.sessions.steer(target, attachments ? { kind: "prompt", text: prompt, attachments } : { kind: "prompt", text: prompt }, callerLabel(req) ?? undefined, { inputId: parsed.data.operationId });
      return ack.ok ? { ok: true } : reply.code(422).send({ ok: false, detail: ack.detail ?? "Versand fehlgeschlagen" });
    } catch (err) {
      return reply.code(422).send({ ok: false, detail: err instanceof Error ? err.message : "Versandfehler" });
    }
  });
}
