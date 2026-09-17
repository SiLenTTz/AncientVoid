import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { hubApi, getToken, type SessionRecord } from "./api.ts";
import { connectTail, type NormalizedEvent, type TailConnection } from "./ws.ts";
import { Composer } from "./Composer.tsx";
import { GlobalDock, type Page } from "./Dock.tsx";

/**
 * T1.6 filter engine — three presets per EPIC-P1 §2/§5 (AC-P1-4), not the
 * four ad-hoc ones P0 shipped ("Alle"/"Lesen"/"Tool-Calls"/"Denken").
 * "Überwachen" is the default: hides thinking entirely and hides large
 * tool_result payloads (AC-P1-4's ">2KB" — measured from EventStore's own
 * K5 byte count when the event was blob-offloaded, else a JSON-size
 * estimate, since the wire event doesn't carry an explicit byte count
 * otherwise).
 */
type FilterPreset = "ueberwachen" | "debuggen" | "lesen";

const LARGE_TOOL_RESULT_BYTES = 2048;

function payloadByteEstimate(e: NormalizedEvent): number {
  const bytes = (e.payload as { bytes?: unknown }).bytes;
  if (typeof bytes === "number") return bytes;
  try {
    return JSON.stringify(e.payload).length;
  } catch {
    return 0;
  }
}

function isLargeToolResult(e: NormalizedEvent): boolean {
  return e.type === "tool_result" && payloadByteEstimate(e) > LARGE_TOOL_RESULT_BYTES;
}

const FILTERS: { id: FilterPreset; label: string; keep: (e: NormalizedEvent) => boolean }[] = [
  { id: "lesen", label: "Lesen", keep: (e) => e.type === "assistant" || e.type === "user" },
  {
    id: "ueberwachen",
    label: "Überwachen",
    keep: (e) => e.type !== "thinking" && !isLargeToolResult(e),
  },
  { id: "debuggen", label: "Debuggen", keep: () => true },
];

/** Filter state is device-local (PRD §6.4, AC-P1-4) — never a server
 * roundtrip, survives reload via localStorage, and is per-device by
 * construction (each browser has its own storage). */
function loadFilter(): FilterPreset {
  const stored = localStorage.getItem("uacc.filter");
  return stored === "lesen" || stored === "ueberwachen" || stored === "debuggen" ? stored : "ueberwachen";
}

/** T1.8: correlates a tool_use with its tool_result by the id both
 * adapters emit under (`payload.id` on tool_use, `payload.toolUseId` on
 * tool_result — verified consistent across adapter-claude and
 * adapter-codex's normalize.ts). */
function toolIdOf(e: NormalizedEvent): string | undefined {
  if (e.type === "tool_use") return (e.payload as { id?: unknown }).id as string | undefined;
  if (e.type === "tool_result") return (e.payload as { toolUseId?: unknown }).toolUseId as string | undefined;
  return undefined;
}

export function SessionTail({ session, onNavigate }: { session: SessionRecord; onNavigate: (page: Page) => void }) {
  const [events, setEvents] = useState<NormalizedEvent[]>([]);
  const [conn, setConn] = useState<"connecting" | "live" | "reconnecting" | "closed">("connecting");
  const [filter, setFilter] = useState<FilterPreset>(loadFilter);
  const [status, setStatus] = useState(session.status);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const tailRef = useRef<HTMLDivElement>(null);
  const connRef = useRef<TailConnection | null>(null);

  // T1.6-3: Chat/Verlauf are the new dock sub-tabs — Chat is exactly the
  // existing "lesen" preset, Verlauf is "ueberwachen"/"debuggen" with a
  // small switcher inside it. `filter` stays the single source of truth
  // (unchanged uacc.filter localStorage key, AC-P1.6-1) so a returning
  // user's last preset — including which tab that implies — still loads
  // correctly; lastVerlaufFilter only remembers which of the two Verlauf
  // presets to restore when hopping back from Chat.
  const [lastVerlaufFilter, setLastVerlaufFilter] = useState<Exclude<FilterPreset, "lesen">>(() => {
    const stored = loadFilter();
    return stored === "lesen" ? "ueberwachen" : stored;
  });
  const tab: "chat" | "verlauf" = filter === "lesen" ? "chat" : "verlauf";

  // T1.5-6: the PWA could watch and stop a session, but never reply to
  // one — POST /api/sessions/:id/steer existed server-side and both real
  // adapters implement it, nothing in the client ever called it.
  const [steerSupported, setSteerSupported] = useState(false);
  const [reply, setReply] = useState("");
  const [replyBusy, setReplyBusy] = useState(false);
  const [replyError, setReplyError] = useState("");

  useEffect(() => {
    let alive = true;
    hubApi
      .adapters()
      .then((adapters) => {
        if (!alive) return;
        const info = adapters.find((a) => a.id === session.adapter);
        // Honest per-adapter check, not a blanket "always show a reply
        // box": an adapter without capabilities.steer gets no reply field
        // at all rather than one that would silently fail every time.
        setSteerSupported(info?.capabilities.steer ?? false);
      })
      .catch(() => setSteerSupported(false));
    return () => {
      alive = false;
    };
  }, [session.adapter]);

  useEffect(() => {
    const base = window.location.origin;
    connRef.current = connectTail({
      url: base,
      token: getToken(),
      sessionId: session.id,
      onEvents: (incoming) => {
        setEvents((prev) => {
          const merged = [...prev, ...incoming];
          return merged.length > 500 ? merged.slice(-500) : merged;
        });
      },
      onState: setConn,
    });
    return () => connRef.current?.close();
  }, [session.id]);

  useEffect(() => {
    const timer = setInterval(async () => {
      try {
        const rec = await hubApi.session(session.id);
        setStatus(rec.status);
      } catch {
        // offline — keep last state
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [session.id]);

  useEffect(() => {
    localStorage.setItem("uacc.filter", filter);
    if (filter !== "lesen") setLastVerlaufFilter(filter);
  }, [filter]);

  const showChatTab = () => setFilter("lesen");
  const showVerlaufTab = () => setFilter(lastVerlaufFilter);

  useEffect(() => {
    tailRef.current?.scrollTo({ top: tailRef.current.scrollHeight });
  }, [events]);

  const visible = useMemo(() => {
    const preset = FILTERS.find((f) => f.id === filter)!;
    return events.filter(preset.keep);
  }, [events, filter]);

  // T1.8: tool_use <-> tool_result status + anchor navigation, built from
  // the full (unfiltered) stream so a match isn't missed just because one
  // side got filtered out under the current preset.
  const toolResultByToolId = useMemo(() => {
    const map = new Map<string, NormalizedEvent>();
    for (const e of events) {
      if (e.type === "tool_result") {
        const id = toolIdOf(e);
        if (id) map.set(id, e);
      }
    }
    return map;
  }, [events]);

  const toggleExpanded = (seq: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(seq)) next.delete(seq);
      else next.add(seq);
      return next;
    });
  };

  const jumpTo = (anchor: string) => {
    document.getElementById(anchor)?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const stop = async () => {
    await hubApi.stopSession(session.id).catch(() => undefined);
  };

  const sendReply = async () => {
    if (!reply.trim()) return;
    setReplyBusy(true);
    setReplyError("");
    try {
      const ack = await hubApi.steer(session.id, { kind: "prompt", text: reply });
      if (ack.ok) {
        setReply("");
      } else {
        // A rejected steer (e.g. claude's "no thread_id captured yet") is
        // shown, not swallowed — an AC-P1.5-7 requirement, and the same
        // honesty standard the rest of this app already applies.
        setReplyError(ack.detail ?? "Antwort wurde abgelehnt");
      }
    } catch (err) {
      setReplyError(err instanceof Error ? err.message : "Antwort fehlgeschlagen");
    } finally {
      setReplyBusy(false);
    }
  };

  // T1.6-3/AC-P1.6-2: no back-arrow up top anymore — "Übersicht" in the
  // dock below is the one way back, reachable from anywhere with one tap.
  const showReply = status !== "stopped" && steerSupported;
  const showVerlaufFilterBar = tab === "verlauf";

  return (
    <div>
      <div class="topbar">
        <div style="flex: 1; min-width: 0">
          <div style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap">
            {session.project.split("/").pop()}
          </div>
          <div class="dim">
            {session.adapter} · <span class={`pill ${status}`}>{status}</span>
          </div>
        </div>
        <div class={`conn-dot ${conn}`} title={conn} />
      </div>

      <div
        ref={tailRef}
        class="tail-scroll"
        style={`overflow-y: auto; max-height: calc(100vh - ${166 + (showVerlaufFilterBar ? 40 : 0) + (showReply ? 110 : 0)}px)`}
      >
        {visible.length === 0 ? (
          <div class="empty">keine Events im Filter</div>
        ) : (
          visible.map((e) => (
            <EventRow
              key={e.seq}
              event={e}
              expanded={expanded.has(e.seq)}
              onToggleExpand={() => toggleExpanded(e.seq)}
              toolResult={e.type === "tool_use" ? toolResultByToolId.get(toolIdOf(e) ?? "") : undefined}
              onJump={jumpTo}
            />
          ))
        )}
      </div>

      <div class="dock-stack">
        {(showReply || status !== "stopped") && (
          <div class="dock-actions">
            {showReply && (
              <>
                {replyError && <div class="reply-error">{replyError}</div>}
                <Composer
                  value={reply}
                  onChange={setReply}
                  placeholder="Antworten…"
                  disabled={replyBusy}
                  adapter={session.adapter}
                  project={session.project}
                />
              </>
            )}
            <div class="row">
              {showReply && (
                <button class="btn primary" onClick={sendReply} disabled={replyBusy || !reply.trim()}>
                  {replyBusy ? "Sende…" : "Senden"}
                </button>
              )}
              {status !== "stopped" && (
                <button class="btn danger" onClick={stop}>
                  Stop
                </button>
              )}
            </div>
          </div>
        )}
        {/* AC-P1.6-2: this sub-filter used to sit right under the topbar
         * (top ~15% zone) — moved down here so every control, not just the
         * dock/tabs, lives in the thumb zone. */}
        {showVerlaufFilterBar && (
          <div class="filter-bar dock-filter-bar">
            {FILTERS.filter((f) => f.id !== "lesen").map((f) => (
              <button key={f.id} class={`chip ${filter === f.id ? "active" : ""}`} onClick={() => setFilter(f.id)}>
                {f.label}
              </button>
            ))}
          </div>
        )}
        <div class="subtabs-wrap">
          <button class={tab === "chat" ? "active" : ""} onClick={showChatTab}>
            Chat
          </button>
          <button class={tab === "verlauf" ? "active" : ""} onClick={showVerlaufTab}>
            Verlauf
          </button>
        </div>
        <GlobalDock active={null} onNavigate={onNavigate} />
      </div>
    </div>
  );
}

function toolAnchor(toolId: string, side: "use" | "result"): string {
  return `tool-${side}-${toolId}`;
}

function EventRow({
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
    // T1.7: dimmed/italic (styles.css .event.thinking), collapsible —
    // collapsed shows only the (already <=200 char) summary; expanded
    // shows the adapter's full reasoning text, when it sent one.
    const fullText = typeof event.payload.text === "string" ? event.payload.text : undefined;
    return (
      <div class="event thinking" data-seq={event.seq}>
        <div class="meta">
          <span>
            #{event.seq} · thinking
            {blobNote}
          </span>
          <span>{time}</span>
        </div>
        <button class="think-toggle" onClick={onToggleExpand}>
          {expanded ? "▾" : "▸"} {expanded ? "einklappen" : "ausklappen"}
        </button>
        <div class="summary">{expanded && fullText ? fullText : event.summary}</div>
      </div>
    );
  }

  if (event.type === "tool_use" && toolId) {
    const state: "running" | "ok" | "error" = !toolResult ? "running" : toolResult.payload.isError ? "error" : "ok";
    return (
      <div id={toolAnchor(toolId, "use")} class="event tool_use" data-seq={event.seq}>
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
      </div>
    );
  }

  if (event.type === "tool_result" && toolId) {
    return (
      <div id={toolAnchor(toolId, "result")} class="event tool_result" data-seq={event.seq}>
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
      </div>
    );
  }

  // AC-P1.5-12: whatever skill/agent a session was started with must be
  // traceable in the tail — sessionmanager.ts stashes it on the
  // session.created system event's payload.args (T1.5-10).
  if (event.type === "system" && (event.payload as { kind?: unknown }).kind === "session.created") {
    const args = (event.payload as { args?: { skill?: string; agent?: string } | null }).args;
    const skillNote = args?.skill ? `Skill: ${args.skill}` : args?.agent ? `Agent: ${args.agent}` : null;
    return (
      <div class="event system" data-seq={event.seq}>
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
      </div>
    );
  }

  return (
    <div class={`event ${event.type}`} data-seq={event.seq}>
      <div class="meta">
        <span>
          #{event.seq} · {event.type}
          {blobNote}
        </span>
        <span>{time}</span>
      </div>
      <div class="summary">{event.summary}</div>
    </div>
  );
}
