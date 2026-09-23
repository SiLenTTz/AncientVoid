import { useEffect, useState } from "preact/hooks";
import { getToken } from "../../shared/api.ts";
import { type NormalizedEvent } from "../../shared/ws.ts";
import { visibleEventText } from "./event-text.ts";
import { toolIdOf } from "./event-filter.ts";

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

export function EventDetail({ event }: { event: NormalizedEvent }) {
  const [blob, setBlob] = useState<string | null>(null);
  useEffect(() => {
    if (!event.blobRef) return;
    const hash = event.blobRef.replace(/^sha256:/, "");
    let alive = true;
    fetch(`/api/sessions/${event.sessionId}/blobs/${hash}`, {
      headers: { authorization: `Bearer ${getToken()}` },
    })
      .then((res) => (res.ok ? res.text() : Promise.reject(new Error("blob"))))
      .then((text) => {
        if (alive) setBlob(text);
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

export function EventRow({
  event,
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
  const time = new Date(event.ts).toLocaleTimeString("de-DE");
  const blobNote = event.blobRef ? " ⛁" : "";
  const toolId = toolIdOf(event);

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
        {expanded && <EventDetail event={event} />}
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
        {expanded && <EventDetail event={event} />}
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
        {expanded && <EventDetail event={event} />}
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
        {expanded && <EventDetail event={event} />}
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
      <div class="summary prose">{visibleEventText(event)}</div>
      {typeof errorDetail === "string" && <div class="dim provider-error-detail">{errorDetail}</div>}
      {expanded && <EventDetail event={event} />}
    </div>
  );
}
