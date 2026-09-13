import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { hubApi, getToken, type SessionRecord } from "./api.ts";
import { connectTail, type NormalizedEvent, type TailConnection } from "./ws.ts";

type FilterPreset = "all" | "assistant" | "tools" | "thinking";

const FILTERS: { id: FilterPreset; label: string; keep: (e: NormalizedEvent) => boolean }[] = [
  { id: "all", label: "Alle", keep: () => true },
  { id: "assistant", label: "Lesen", keep: (e) => e.type === "assistant" || e.type === "user" },
  {
    id: "tools",
    label: "Tool-Calls",
    keep: (e) => e.type === "tool_use" || e.type === "tool_result",
  },
  { id: "thinking", label: "Denken", keep: (e) => e.type === "thinking" },
];

/** Filter state is device-local (PRD §6.4) — never a server roundtrip. */
function loadFilter(): FilterPreset {
  return (localStorage.getItem("uacc.filter") as FilterPreset) ?? "all";
}

export function SessionTail({ session, onBack }: { session: SessionRecord; onBack: () => void }) {
  const [events, setEvents] = useState<NormalizedEvent[]>([]);
  const [conn, setConn] = useState<"connecting" | "live" | "reconnecting" | "closed">("connecting");
  const [filter, setFilter] = useState<FilterPreset>(loadFilter);
  const [status, setStatus] = useState(session.status);
  const tailRef = useRef<HTMLDivElement>(null);
  const connRef = useRef<TailConnection | null>(null);

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
  }, [filter]);

  useEffect(() => {
    tailRef.current?.scrollTo({ top: tailRef.current.scrollHeight });
  }, [events]);

  const visible = useMemo(() => {
    const preset = FILTERS.find((f) => f.id === filter)!;
    return events.filter(preset.keep);
  }, [events, filter]);

  const stop = async () => {
    await hubApi.stopSession(session.id).catch(() => undefined);
  };

  return (
    <div>
      <div class="topbar">
        <button class="btn" onClick={onBack}>
          ←
        </button>
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

      <div class="filter-bar">
        {FILTERS.map((f) => (
          <button key={f.id} class={`chip ${filter === f.id ? "active" : ""}`} onClick={() => setFilter(f.id)}>
            {f.label}
          </button>
        ))}
      </div>

      <div ref={tailRef} style="overflow-y: auto; max-height: calc(100vh - 190px)">
        {visible.length === 0 ? (
          <div class="empty">keine Events im Filter</div>
        ) : (
          visible.map((e) => <EventRow key={e.seq} event={e} />)
        )}
      </div>

      <div class="bottom-actions">
        {status !== "stopped" && (
          <button class="btn danger" onClick={stop}>
            Stop
          </button>
        )}
      </div>
    </div>
  );
}

function EventRow({ event }: { event: NormalizedEvent }) {
  const time = new Date(event.ts).toLocaleTimeString("de-DE");
  const blobNote = event.blobRef ? " ⛁" : "";
  return (
    <div class={`event ${event.type}`}>
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
