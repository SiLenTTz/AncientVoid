import type { DigestLesson, DigestLessonKind, NormalizedEvent, SessionRecord, SessionSummary } from "@uacc/contracts";

/**
 * T4.2 (EPIC-P4 §3 "Digest-Pipeline") / ADR-0009 — turns one completed
 * session's real event log into a SessionSummary. Deliberately
 * RULE-BASED, not LLM summarization: this repo has no built-in language
 * model, and faking a summary would be an R9.7 violation. Every lesson
 * traces back to real, already-meaningful event types/kinds this repo's
 * own event taxonomy already recognizes — never freehand text.
 */

/** Real `payload.kind` strings SessionManager itself already emits
 * (`emitSystem()`, grep-verified against session-manager.ts) — mapped to a
 * DigestLessonKind. Anything not in this list is real telemetry but not
 * digest-worthy (e.g. "session.created", "session.steer" — routine, not a
 * decision or a failure). */
const SYSTEM_KIND_TO_LESSON: Partial<Record<string, DigestLessonKind>> = {
  "session.approval_decided": "approval",
  "session.budget_exceeded": "budget",
  "session.daily_cap_exceeded": "budget",
  "session.budget_warning": "budget",
  "session.worktree_failed": "failure",
  "session.start_failed": "failure",
  "session.recovery_failed": "failure",
  "adapter.down": "failure",
  "session.parked": "decision",
};

function extractLessons(events: NormalizedEvent[]): DigestLesson[] {
  const lessons: DigestLesson[] = [];
  for (const event of events) {
    if (event.type === "gate") {
      lessons.push({ kind: "decision", text: event.summary, eventSeq: [event.seq] });
      continue;
    }
    if (event.type === "error") {
      lessons.push({ kind: "failure", text: event.summary, eventSeq: [event.seq] });
      continue;
    }
    if (event.type === "system") {
      const kindField = (event.payload as { kind?: unknown }).kind;
      const mapped = typeof kindField === "string" ? SYSTEM_KIND_TO_LESSON[kindField] : undefined;
      if (mapped) lessons.push({ kind: mapped, text: event.summary, eventSeq: [event.seq] });
    }
  }
  return lessons;
}

/** `sessionId/events.jsonl` — EventStore's own real path convention
 * (`packages/core/src/eventstore.ts`'s `sessionDir`/`filePath`), relative
 * to dataDir so the reference stays portable across deployments. */
export function archiveRefFor(sessionId: string): string {
  return `sessions/${sessionId}/events.jsonl`;
}

export function buildSessionSummary(record: SessionRecord, events: NormalizedEvent[]): SessionSummary {
  return {
    sessionId: record.id,
    adapter: record.adapter,
    project: record.project,
    model: record.model,
    startedAt: record.createdAt,
    endedAt: record.updatedAt,
    costUsd: record.costUsd,
    tokensEst: record.tokensEst,
    eventCount: events.length,
    lessons: extractLessons(events),
    archiveRef: archiveRefFor(record.id),
  };
}
