import { memo } from "preact/compat";
import { useEffect, useState } from "preact/hooks";
import { getToken } from "../../shared/api.ts";
import { type NormalizedEvent } from "../../shared/ws.ts";
import { isOffloaded, visibleEventText, withBlobPayload } from "./event-text.ts";
import { isEmptyThinking, toolIdOf } from "./event-filter.ts";
import { Markdown } from "../../shared/Markdown.tsx";
import { AttachmentChips, type AttachmentRef } from "../attachments/Attachments.tsx";

export function toolAnchor(toolId: string, side: "use" | "result"): string {
  return `tool-${side}-${toolId}`;
}

export function eventDetail(event: NormalizedEvent): string {
  const payload = event.payload;
  for (const key of ["text", "output", "error"] as const) {
    const value = payload[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  try {
    return JSON.stringify(payload, null, 2);
  } catch {
    return event.summary;
  }
}

/** Blob texts by hash — rows remount while scrolling, the blob never changes. */
const blobCache = new Map<string, string>();

function fetchBlob(event: NormalizedEvent): Promise<string> {
  const hash = (event.blobRef ?? "").replace(/^sha256:/, "");
  const hit = blobCache.get(hash);
  if (hit !== undefined) return Promise.resolve(hit);
  return fetch(`/api/sessions/${event.sessionId}/blobs/${hash}`, {
    headers: { authorization: `Bearer ${getToken()}` },
  })
    .then((res) => (res.ok ? res.text() : Promise.reject(new Error("blob"))))
    .then((text) => {
      if (blobCache.size > 200) blobCache.delete(blobCache.keys().next().value!);
      blobCache.set(hash, text);
      return text;
    });
}

/** BUG-0068: an answer over 4 KB lives in a blob — load it so the chat
 * shows the whole text. `failed` keeps the shortened row honest. */
function useFullEvent(event: NormalizedEvent): { event: NormalizedEvent; state: "ok" | "loading" | "failed" } {
  const offloaded = isOffloaded(event);
  const [raw, setRaw] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!offloaded) return;
    let alive = true;
    fetchBlob(event)
      .then((text) => {
        if (alive) setRaw(text);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [offloaded, event.blobRef, event.sessionId]);
  if (!offloaded) return { event, state: "ok" };
  if (raw !== null) return { event: withBlobPayload(event, raw), state: "ok" };
  return { event, state: failed ? "failed" : "loading" };
}

export function EventDetail({ event }: { event: NormalizedEvent }) {
  const [blob, setBlob] = useState<string | null>(null);
  useEffect(() => {
    if (!event.blobRef) return;
    let alive = true;
    fetchBlob(event)
      .then((text) => {
        if (alive) setBlob(isOffloaded(event) ? eventDetail(withBlobPayload(event, text)) : text);
      })
      .catch(() => {
        if (alive) setBlob("Details konnten nicht geladen werden.");
      });
    return () => {
      alive = false;
    };
  }, [event.blobRef, event.sessionId]);
  return <pre class="event-detail">{blob ?? eventDetail(event)}</pre>;
}

export function onCardClick(ev: { target: EventTarget | null }, toggle: () => void) {
  const target = ev.target as HTMLElement | null;
  if (target?.closest("button, a")) return;
  toggle();
}

function EventRowView({
  event: rowEvent,
  expanded,
  onToggleExpand,
  toolResult,
  onJump,
}: {
  event: NormalizedEvent;
  expanded: boolean;
  onToggleExpand: () => void;
  /** Only set for tool_use rows — the matching tool_result, if it has
   * arrived yet (undefined -> still running). */
  toolResult: NormalizedEvent | undefined;
  onJump: (anchor: string) => void;
}) {
  const { event, state: fullText } = useFullEvent(rowEvent);
  const time = new Date(event.ts).toLocaleTimeString("de-DE");
  const blobNote = event.blobRef ? " ⛁" : "";
  const toolId = toolIdOf(event);

  if (isEmptyThinking(event)) {
    // BUG-0046: the provider withheld the text — one quiet line, nothing to expand or copy.
    return (
      <div class="event thinking withheld" data-seq={event.seq}>
        <div class="meta">
          <span>#{event.seq} · thinking</span>
          <span>{time}</span>
        </div>
        <div class="summary">Claude hat nachgedacht — der Anbieter liefert den Text nicht</div>
      </div>
    );
  }

  if (event.type === "thinking") {
    // T1.7: dimmed/italic (app/styles/ .event.thinking), collapsible —
    // collapsed shows only the (already <=200 char) summary; expanded
    // shows the adapter's full reasoning text, when it sent one.
    return (
      <div class={`event thinking${expanded ? " expanded" : ""}`} data-seq={event.seq} onClick={(ev) => onCardClick(ev, onToggleExpand)}>
        <div class="meta">
          <span>
            {expanded ? "▾" : "▸"} #{event.seq} · thinking
            {blobNote}
          </span>
          <span>{time}</span>
        </div>
        <div class="summary">{event.summary}</div>
        <CopyButton text={copyText(event)} />
        {expanded && <EventDetail event={rowEvent} />}
      </div>
    );
  }

  if (event.type === "tool_use" && toolId) {
    const state: "running" | "ok" | "error" = !toolResult ? "running" : toolResult.payload.isError ? "error" : "ok";
    return (
      <div id={toolAnchor(toolId, "use")} class={`event tool_use${expanded ? " expanded" : ""}`} data-seq={event.seq} onClick={(ev) => onCardClick(ev, onToggleExpand)}>
        <div class="meta">
          <span>
            #{event.seq} · tool_use
            {blobNote}
          </span>
          <span>{time}</span>
        </div>
        <div class="row">
          <span class={`tool-status ${state}`}>{state}</span>
          {toolResult && (
            <button class="link-btn" onClick={() => onJump(toolAnchor(toolId, "result"))}>
              zum Ergebnis ↓
            </button>
          )}
        </div>
        <div class="summary">{event.summary}</div>
        <CopyButton text={copyText(event)} />
        {expanded && <EventDetail event={rowEvent} />}
      </div>
    );
  }

  if (event.type === "tool_result" && toolId) {
    return (
      <div
        id={toolAnchor(toolId, "result")}
        class={`event tool_result${expanded ? " expanded" : ""}`}
        data-seq={event.seq}
        onClick={(ev) => onCardClick(ev, onToggleExpand)}
      >
        <div class="meta">
          <span>
            #{event.seq} · tool_result
            {blobNote}
          </span>
          <span>{time}</span>
        </div>
        <div class="row">
          <button class="link-btn" onClick={() => onJump(toolAnchor(toolId, "use"))}>
            ↑ zum Aufruf
          </button>
        </div>
        <div class="summary">{event.summary}</div>
        <CopyButton text={copyText(event)} />
        {expanded && <EventDetail event={rowEvent} />}
      </div>
    );
  }

  // AC-P1.5-12: whatever skill/agent a session was started with must be
  // traceable in the tail — session-manager.ts stashes it on the
  // session.created system event's payload.args (T1.5-10).
  if (event.type === "system" && (event.payload as { kind?: unknown }).kind === "session.created") {
    const args = (event.payload as { args?: { skill?: string; agent?: string } | null }).args;
    const skillNote = args?.skill ? `Skill: ${args.skill}` : args?.agent ? `Agent: ${args.agent}` : null;
    return (
      <div class={`event system${expanded ? " expanded" : ""}`} data-seq={event.seq} onClick={(ev) => onCardClick(ev, onToggleExpand)}>
        <div class="meta">
          <span>
            #{event.seq} · {event.type}
            {blobNote}
          </span>
          <span>{time}</span>
        </div>
        <div class="summary">
          {event.summary}
          {skillNote && <span class="badge waiting"> · Gestartet mit {skillNote}</span>}
        </div>
        {expanded && <EventDetail event={rowEvent} />}
      </div>
    );
  }

  // The hub's own record of what the user typed (session.prompt).
  const prompt = event.type === "user" && (event.payload as { kind?: unknown }).kind === "session.prompt";
  const device = prompt ? (event.payload as { actor?: unknown }).actor : null;
  // ADR-0015: a provider failure, in words, with what to do next.
  const providerError = (event.payload as { kind?: unknown }).kind === "provider.error";
  const errorDetail = providerError ? (event.payload as { detail?: unknown }).detail : null;
  return (
    <div class={`event ${event.type}${prompt ? " own" : ""}${providerError ? " provider-error" : ""}${expanded ? " expanded" : ""}`} data-seq={event.seq} onClick={(ev) => onCardClick(ev, onToggleExpand)}>
      <div class="meta">
        <span>
          {prompt ? `Du${typeof device === "string" && device ? ` · ${device}` : ""}` : `#${event.seq} · ${event.type}`}
          {blobNote}
        </span>
        <span>{time}</span>
      </div>
      {event.type === "assistant" ? (
        <Markdown class="summary prose" text={visibleEventText(event)} />
      ) : (
        <div class="summary prose">{visibleEventText(event)}</div>
      )}
      {fullText !== "ok" && (
        <div class={`dim full-text-note${fullText === "failed" ? " failed" : ""}`}>
          {fullText === "loading" ? "Langer Text wird geladen …" : "Gekürzt — der volle Text konnte nicht geladen werden."}
        </div>
      )}
      {prompt && Array.isArray((event.payload as { attachments?: unknown }).attachments) && (
        <AttachmentChips refs={(event.payload as { attachments: AttachmentRef[] }).attachments} />
      )}
      {typeof errorDetail === "string" && <div class="dim provider-error-detail">{errorDetail}</div>}
      {(event.type === "assistant" || prompt) && <CopyButton text={visibleEventText(event)} />}
      {expanded && <EventDetail event={rowEvent} />}
    </div>
  );
}

/** What a row's copy button copies: the full payload text — tool inputs
 * as formatted JSON, results as their content, else the visible text. */
function copyText(event: NormalizedEvent): string {
  if (event.type === "tool_use") return JSON.stringify((event.payload as { input?: unknown }).input ?? null, null, 2);
  if (event.type === "tool_result") {
    const content = (event.payload as { content?: unknown }).content;
    if (typeof content === "string" && content.length > 0) return content;
  }
  const text = (event.payload as { text?: unknown }).text;
  return typeof text === "string" && text.length > 0 ? text : visibleEventText(event);
}

/** T8.4: take an answer along — one tap, no selecting on a phone. */
function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState<"" | "ok" | "fail">("");
  return (
    <button
      type="button"
      class="link-btn copy-btn"
      onClick={(ev) => {
        ev.stopPropagation();
        navigator.clipboard
          ?.writeText(text)
          .then(() => setDone("ok"))
          .catch(() => setDone("fail"));
        setTimeout(() => setDone(""), 1500);
      }}
    >
      {done === "ok" ? "kopiert" : done === "fail" ? "nicht erlaubt" : "Kopieren"}
    </button>
  );
}

/** EPIC-P18 T18.6 (K2 with four tiles): a row renders again only when what
 * it shows changed. Every WS batch re-rendered up to 500 rows per tile —
 * p95 880 ms with four tiles at 30 ev/s. The callbacks are left out on
 * purpose: they are recreated each render but do the same for this row. */
export const EventRow = memo(
  EventRowView,
  (a, b) => a.event === b.event && a.expanded === b.expanded && a.toolResult === b.toolResult,
);
