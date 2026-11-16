import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ReviewNote, ReviewNoteView } from "@ancientvoid/contracts";
import { CreateReviewNoteInput, REVIEW_NOTE_MAX_CHARS, SetReviewNoteStatusInput, SendReviewFeedbackInput } from "@ancientvoid/contracts";
import { composeFeedbackPackage, composeFeedbackPrompt, promptNeedsAttachment } from "@ancientvoid/core";
import type { AttachmentStore, SessionManager } from "@ancientvoid/core";
import type { RouteContext } from "../../route-context.ts";
import { getSessionDiff, type SessionDiffResult } from "../sessions/diff.ts";
import { currentHeadSha } from "./git-context.ts";
import { validateNote } from "./validate.ts";

/**
 * EPIC-P36 / ADR-0055: Review-Notizen zur Diff-Ansicht. Kanonischer Zustand
 * liegt im ReviewStore (Journal+Snapshot, K7); diese Routen validieren,
 * falten Status und versenden gesammelt über den bestehenden Steer-Pfad
 * (Operations-ID = Steer-inputId, kein zweites Queue-System).
 */

const UpdateReviewNoteInput = z.object({ text: z.string().min(1).max(REVIEW_NOTE_MAX_CHARS) });

/** Ohne konfigurierte Anhänge darf der Inline-Prompt nicht unbegrenzt wachsen. */
const SEND_INLINE_HARD_CAP_CHARS = 30_000;

/** Diff + HEAD kurz cachen — Notizliste validiert sonst bei jedem Poll doppelt gegen git. */
const DIFF_CACHE_TTL_MS = 5_000;
const diffCache = new Map<string, { at: number; diff: SessionDiffResult; head: string | null }>();

/** Nur für Tests: Diff/HEAD-Cache verwerfen, wenn das Repo unter dem Hub
 * weg geändert wurde (Produktion toleriert 5 s, Tests nicht). */
export function resetDiffCacheForTests(): void {
  diffCache.clear();
}

async function diffContextFor(sessions: SessionManager, id: string): Promise<{ diff: SessionDiffResult; head: string | null } | null> {
  const session = sessions.get(id);
  if (!session) return null;
  const cached = diffCache.get(id);
  if (cached && Date.now() - cached.at < DIFF_CACHE_TTL_MS) return cached;
  const workdir = sessions.workdirOf(id) ?? session.project;
  const [diff, head] = await Promise.all([getSessionDiff(workdir, session.worktreeSha), currentHeadSha(workdir)]);
  const entry = { at: Date.now(), diff, head };
  if (diffCache.size > 100) diffCache.clear();
  diffCache.set(id, entry);
  return entry;
}

export function registerReviewsRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { deps, callerLabel } = ctx;
  const reviews = deps.reviews;
  if (!reviews) {
    // Gleiches Muster wie Approvals/WebAuthn: ohne Store keine Halbfabrikate.
    app.get("/api/sessions/:id/reviews", async () => ({ error: "Reviews sind auf diesem Hub nicht eingerichtet." }));
    return;
  }

  const viewsFor = async (sessions: SessionManager, id: string): Promise<ReviewNoteView[]> => {
    const context = await diffContextFor(sessions, id);
    return reviews.list(id).map((note) => {
      if (!context || context.diff.error) {
        return { ...note, anchorState: "unclear", staleReason: context ? `Diff nicht bestimmbar: ${context.diff.error}` : "Session unbekannt" };
      }
      const verdict = validateNote(note, context.diff, context.head);
      return { ...note, ...verdict };
    });
  };

  app.get("/api/sessions/:id/reviews", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!deps.sessions.get(id)) return reply.code(404).send({ error: "unknown session" });
    return { items: await viewsFor(deps.sessions, id), journalSkippedLines: reviews.recoveryReport(id).skippedLines };
  });

  app.post("/api/sessions/:id/reviews", async (req, reply) => {
    if (req.policy?.decision === "approve") return reply.code(403).send({ error: "Review-Notizen sind menschliche Eingaben." });
    const { id } = req.params as { id: string };
    if (!deps.sessions.get(id)) return reply.code(404).send({ error: "unknown session" });
    const parsed = CreateReviewNoteInput.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid review note", issues: parsed.error.issues });
    const input = parsed.data;
    // headSha ergänzt der Hub (ADR-0055 §1): die Identität des uncommitteten
    // Rests ist Server-Wissen, die PWA kennt nur baseRef.
    if (input.basis.scope.kind === "uncommitted" && (input.basis.headSha === null || input.basis.headSha === undefined)) {
      const context = await diffContextFor(deps.sessions, id);
      input.basis.headSha = context?.head ?? null;
    }
    const note = reviews.create(id, input);
    return reply.code(201).send({ note });
  });

  app.patch("/api/sessions/:id/reviews/:noteId", async (req, reply) => {
    if (req.policy?.decision === "approve") return reply.code(403).send({ error: "Review-Notizen sind menschliche Eingaben." });
    const { id, noteId } = req.params as { id: string; noteId: string };
    const parsed = UpdateReviewNoteInput.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid review note", issues: parsed.error.issues });
    const note = reviews.updateText(id, noteId, parsed.data.text);
    if (!note) return reply.code(404).send({ error: "unknown review note" });
    return { note };
  });

  app.delete("/api/sessions/:id/reviews/:noteId", async (req, reply) => {
    if (req.policy?.decision === "approve") return reply.code(403).send({ error: "Review-Notizen sind menschliche Eingaben." });
    const { id, noteId } = req.params as { id: string; noteId: string };
    const removed = reviews.delete(id, noteId);
    return removed ? reply.code(200).send({ ok: true }) : reply.code(404).send({ error: "unknown review note" });
  });

  app.post("/api/sessions/:id/reviews/:noteId/status", async (req, reply) => {
    if (req.policy?.decision === "approve") return reply.code(403).send({ error: "Review-Status setzt ein Mensch." });
    const { id, noteId } = req.params as { id: string; noteId: string };
    const parsed = SetReviewNoteStatusInput.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid status", issues: parsed.error.issues });
    const note = reviews.setStatus(id, noteId, parsed.data.status);
    if (!note) return reply.code(404).send({ error: "unknown review note" });
    return { note };
  });

  /** Vorschau des gebündelten Prompts — dieselbe Komposition, die der
   * Versand später tatsächlich abschickt (keine zweite Formatierung). */
  app.post("/api/sessions/:id/reviews/preview", async (req, reply) => {
    if (req.policy?.decision === "approve") return reply.code(403).send({ error: "Vorschau ist für Menschen." });
    const { id } = req.params as { id: string };
    if (!deps.sessions.get(id)) return reply.code(404).send({ error: "unknown session" });
    const parsed = z.object({ noteIds: z.array(z.string().uuid()).min(1) }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid preview input", issues: parsed.error.issues });
    const selected = parsed.data.noteIds
      .map((nid) => reviews.get(id, nid))
      .filter((n): n is ReviewNote => Boolean(n));
    if (selected.length === 0) return reply.code(404).send({ error: "unknown review notes" });
    return { prompt: composeFeedbackPrompt(selected), needsAttachment: promptNeedsAttachment(selected) };
  });

  app.post("/api/sessions/:id/reviews/send", async (req, reply) => {
    if (req.policy?.decision === "approve") return reply.code(403).send({ error: "Review-Feedback versendet ein Mensch." });
    const { id } = req.params as { id: string };
    if (!deps.sessions.get(id)) return reply.code(404).send({ error: "unknown session" });
    const parsed = SendReviewFeedbackInput.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid send input", issues: parsed.error.issues });
    const { noteIds, targetSessionId, operationId } = parsed.data;

    const target = targetSessionId ?? id;
    if (!deps.sessions.get(target)) return reply.code(404).send({ ok: false, detail: "Empfänger-Session unbekannt" });

    const selected: ReviewNote[] = noteIds.map((nid) => reviews.get(id, nid)).filter((n): n is ReviewNote => Boolean(n));
    const missing = noteIds.filter((nid) => !reviews.get(id, nid));
    if (missing.length > 0) return reply.code(422).send({ ok: false, detail: `Unbekannte Notizen: ${missing.join(", ")}` });

    // Veraltete Anker nicht versenden — der Bezug wäre nicht mehr nachvollziehbar (AC-P36-2).
    const views = await viewsFor(deps.sessions, id);
    const stale = views.filter((v) => v.anchorState === "stale" && noteIds.includes(v.id));
    if (stale.length > 0) {
      const detail = `Veraltete Anker zuerst neu verankern oder entfernen: ${stale.map((s) => `${s.anchor.path} (${s.staleReason})`).join("; ")}`;
      // Auch der abgewiesene Versand ist ein Befund an der Notiz (AC-P36-5).
      reviews.recordSend(id, { operationId, noteIds, ok: false, detail });
      return reply.code(422).send({ ok: false, detail });
    }

    const prompt = composeFeedbackPrompt(selected);
    let attachments: { data: Uint8Array; name: string; mimeType: string } | null = null;
    if (promptNeedsAttachment(selected)) {
      const store = (deps as { attachments?: AttachmentStore }).attachments;
      if (store) {
        attachments = { data: new TextEncoder().encode(composeFeedbackPackage(selected)), name: "review-feedback.md", mimeType: "text/markdown" };
      } else if (prompt.length > SEND_INLINE_HARD_CAP_CHARS) {
        return reply.code(422).send({ ok: false, detail: "Feedback-Paket zu groß und keine Anhänge konfiguriert." });
      }
    }

    let promptToSend = prompt;
    let attachmentIds: string[] | undefined;
    if (attachments) {
      try {
        const store = (deps as { attachments?: AttachmentStore }).attachments!;
        const record = await store.save(attachments.data, attachments.name, attachments.mimeType);
        attachmentIds = [record.id];
        promptToSend = `${prompt}\n\n(Vollständiges Feedback-Paket im Anhang review-feedback.md)`;
      } catch (err) {
        return reply.code(422).send({ ok: false, detail: err instanceof Error ? err.message : "Anhang fehlgeschlagen" });
      }
    }

    let ack: Awaited<ReturnType<SessionManager["steer"]>>;
    try {
      ack = await deps.sessions.steer(
        target,
        attachmentIds
          ? { kind: "prompt", text: promptToSend, attachments: await deps.attachments!.resolve(attachmentIds) }
          : { kind: "prompt", text: promptToSend },
        callerLabel(req) ?? undefined,
        { inputId: operationId },
      );
    } catch (err) {
      const detail = err instanceof Error ? err.message : "Versandfehler";
      reviews.recordSend(id, { operationId, noteIds, ok: false, detail });
      return reply.code(422).send({ ok: false, detail });
    }
    reviews.recordSend(id, { operationId, noteIds, ok: ack.ok, detail: "detail" in ack && typeof ack.detail === "string" ? ack.detail : null });
    if (!ack.ok) {
      // Notizen bleiben Entwurf mit Ursache (AC-P36-5) — nie still, nie doppelt blind retryen.
      return reply.code(422).send({ ok: false, detail: ack.detail ?? "Versand fehlgeschlagen" });
    }
    return { ok: true, prompt, attachmentIds: attachmentIds ?? [] };
  });
}
