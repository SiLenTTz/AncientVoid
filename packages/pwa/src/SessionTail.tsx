import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { ApiContext, useApi } from "./api-context.ts";
import { getToken, hostApi, remoteHost, newInputId, steerRejectText, type SessionRecord, type AdapterUsage, type SessionDiffResult, type DiffHunk } from "./api.ts";
import { connectTail, type NormalizedEvent, type TailConnection } from "./ws.ts";
import { Composer } from "./Composer.tsx";
import { visibleEventText } from "./event-text.ts";
import { GlobalDock, type Page } from "./Dock.tsx";
import { VoiceSheet } from "./VoiceSheet.tsx";
import { formatUsd, formatWindow } from "./Dashboard.tsx";
import { SearchPane } from "./Search.tsx";
import { formatMinutes, quotaSummary, runProgress } from "./run-progress.ts";

/**
 * T1.6 filter engine — three presets per EPIC-P1 §2/§5 (AC-P1-4), not the
 * four ad-hoc ones P0 shipped ("Alle"/"Lesen"/"Tool-Calls"/"Denken").
 * "Überwachen" is the default: hides large
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

function showInChat(event: NormalizedEvent): boolean {
  if (event.type === "assistant" || event.type === "user" || event.type === "thinking") return true;
  if (event.type !== "system") return false;
  const payload = event.payload as { kind?: unknown; reason?: unknown };
  return (
    payload.kind === "opencode.model" ||
    payload.kind === "opencode.step_start" ||
    payload.kind === "session.skill_chain" ||
    payload.kind === "provider.error" ||
    (payload.kind === "opencode.step_finish" && payload.reason === "length")
  );
}

const FILTERS: { id: FilterPreset; label: string; keep: (e: NormalizedEvent) => boolean }[] = [
  { id: "lesen", label: "Lesen", keep: showInChat },
  {
    id: "ueberwachen",
    label: "Überwachen",
    keep: (e) => !isLargeToolResult(e),
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
  // EPIC-P6: every call of this view goes to the session's own host.
  const api = useMemo(() => hostApi(session.hostId), [session.hostId]);
  const [events, setEvents] = useState<NormalizedEvent[]>([]);
  const [conn, setConn] = useState<"connecting" | "live" | "reconnecting" | "closed">("connecting");
  const [filter, setFilter] = useState<FilterPreset>(loadFilter);
  const [status, setStatus] = useState(session.status);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const tailRef = useRef<HTMLDivElement>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  // The tail ends exactly where the fixed controls start — measured, not
  // guessed: a taller composer (draft, recommendation, error) used to cover
  // the last message.
  const [tailMaxHeight, setTailMaxHeight] = useState<number | null>(null);
  const [controlsHidden, setControlsHidden] = useState(() => localStorage.getItem("uacc.controlsHidden") === "1");
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
  // T1.6-4: Bericht is a third dock tab, orthogonal to the Chat/Verlauf
  // filter split above — it replaces the event list with a summary pane
  // instead of filtering it, so it needs its own bit of state rather than
  // being derived from `filter` like Chat/Verlauf are.
  const [activeTab, setActiveTab] = useState<"chat" | "verlauf" | "bericht" | "diff" | "suche">(() =>
    loadFilter() === "lesen" ? "chat" : "verlauf",
  );

  // T1.5-6: the PWA could watch and stop a session, but never reply to
  // one — POST /api/sessions/:id/steer existed server-side and both real
  // adapters implement it, nothing in the client ever called it.
  const [steerSupported, setSteerSupported] = useState(false);
  // T1.6-4: claude's result line is the one real source for both costUsd
  // and tokensEst (ADR-0006) — reusing capabilities().cost as the signal
  // for "this adapter's Bericht numbers are real" avoids inventing a
  // second capability flag for data that already arrives together.
  const [reportNumbersReal, setReportNumbersReal] = useState(false);
  const [reply, setReply] = useState("");
  const [replyBusy, setReplyBusy] = useState(false);
  const [replyError, setReplyError] = useState("");
  // Same text sent again after a failure keeps its input id (BUG-0016).
  const pendingInput = useRef<{ text: string; id: string } | null>(null);
  // T5.5: another device holds the writer lease — offer to take it over.
  const [leaseHeld, setLeaseHeld] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [archived, setArchived] = useState(session.archived === true);

  useEffect(() => {
    let alive = true;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const load = () =>
      api
        .adapters()
        .then((adapters) => {
          if (!alive) return;
          const info = adapters.find((a) => a.id === session.adapter);
          // Honest per-adapter check, not a blanket "always show a reply
          // box": an adapter without capabilities.steer gets no reply field
          // at all rather than one that would silently fail every time.
          setSteerSupported(info?.capabilities.features?.followUp ?? info?.capabilities.steer ?? false);
          setReportNumbersReal(info?.capabilities.cost ?? false);
        })
        .catch(() => {
          if (!alive) return;
          setSteerSupported(false);
          setReportNumbersReal(false);
          // BUG-0022: the hub was unreachable while opening — ask again
          // instead of hiding the reply field until a reload.
          retry = setTimeout(() => void load(), 3000);
        });
    void load();
    return () => {
      alive = false;
      clearTimeout(retry);
    };
  }, [session.adapter]);

  useEffect(() => {
    const base = window.location.origin;
    connRef.current = connectTail({
      url: base,
      token: getToken(),
      sessionId: session.id,
      hostId: remoteHost(session.hostId),
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

  // T1.6-4: extends the existing 3s status poll to also carry costUsd/
  // tokensEst/updatedAt for the Bericht tab — not a second independent
  // timer (same principle as T1.5-3's usage poll).
  const [record, setRecord] = useState<SessionRecord>(session);
  useEffect(() => {
    const timer = setInterval(async () => {
      try {
        const rec = await api.session(session.id);
        setStatus(rec.status);
        setRecord(rec);
      } catch {
        // offline — keep last state
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [session.id]);

  // T1.6-4/T1.6-5: fetched only while Bericht or Diff is the open tab, not
  // continuously — both are periodic-check views, not a live stream, and
  // share the one /diff endpoint instead of each fetching it separately.
  const [diff, setDiff] = useState<SessionDiffResult | null>(null);
  const [usage, setUsage] = useState<AdapterUsage | null>(null);
  useEffect(() => {
    if (activeTab !== "bericht" && activeTab !== "diff") return;
    let alive = true;
    api
      .sessionDiff(session.id)
      .then((d) => alive && setDiff(d))
      .catch(() => alive && setDiff(null));
    if (activeTab === "bericht") {
      api
        .adapterUsage(session.adapter)
        .then((u) => alive && setUsage(u))
        .catch(() => alive && setUsage(null));
    }
    return () => {
      alive = false;
    };
  }, [activeTab, session.id, session.adapter]);

  useEffect(() => {
    localStorage.setItem("uacc.filter", filter);
    if (filter !== "lesen") setLastVerlaufFilter(filter);
  }, [filter]);

  const showChatTab = () => {
    setActiveTab("chat");
    setFilter("lesen");
  };
  const showVerlaufTab = () => {
    setActiveTab("verlauf");
    setFilter(lastVerlaufFilter);
  };
  const showBerichtTab = () => setActiveTab("bericht");
  const showDiffTab = () => setActiveTab("diff");
  const showSucheTab = () => setActiveTab("suche");

  useEffect(() => {
    tailRef.current?.scrollTo({ top: tailRef.current.scrollHeight });
  }, [events]);

  useEffect(() => {
    const measure = () => {
      const tail = tailRef.current;
      const dock = dockRef.current;
      if (!tail || !dock) return;
      const available = window.innerHeight - tail.getBoundingClientRect().top - dock.getBoundingClientRect().height - 8;
      setTailMaxHeight(Math.max(120, Math.floor(available)));
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (dockRef.current) observer.observe(dockRef.current);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  // Run strip: progress of the current turn and the provider's quota.
  const [now, setNow] = useState(Date.now());
  const [quotaUsage, setQuotaUsage] = useState<AdapterUsage | null>(null);
  useEffect(() => {
    if (status !== "working") return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [status]);
  useEffect(() => {
    let alive = true;
    const load = () =>
      api
        .adapterUsage(session.adapter)
        .then((u) => alive && setQuotaUsage(u))
        .catch(() => undefined);
    void load();
    const timer = setInterval(() => void load(), 15_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [session.adapter]);
  const progress = runProgress(events, status, now);
  const quota = quotaSummary(quotaUsage, events);

  const toggleControls = () => {
    setControlsHidden((hidden) => {
      localStorage.setItem("uacc.controlsHidden", hidden ? "0" : "1");
      return !hidden;
    });
  };

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

  const toggleArchive = async () => {
    const next = !archived;
    try {
      const updated = await api.setArchived(session.id, next);
      setArchived(updated.archived === true);
    } catch (err) {
      setReplyError(err instanceof Error ? err.message : "Archivieren fehlgeschlagen.");
    }
  };

  const stop = async () => {
    // Real bug found live-testing T3.10: this used to swallow every
    // failure silently (`.catch(() => undefined)`) — the button could do
    // nothing and the user would have no way to know. Now surfaces a real
    // failure the same way a rejected reply already does.
    try {
      const ack = await api.stopSession(session.id);
      if (!ack.ok) setReplyError("Stop fehlgeschlagen.");
    } catch (err) {
      setReplyError(err instanceof Error ? err.message : "Stop fehlgeschlagen.");
    }
  };

  const sendReply = async (takeover = false) => {
    if (!reply.trim()) return;
    setReplyBusy(true);
    setReplyError("");
    setLeaseHeld(false);
    try {
      if (pendingInput.current?.text !== reply) pendingInput.current = { text: reply, id: newInputId() };
      const ack = await api.steer(session.id, { kind: "prompt", text: reply }, pendingInput.current.id, takeover);
      if (ack.ok) {
        pendingInput.current = null;
        setReply("");
      } else {
        setLeaseHeld(ack.detail === "writer lease held");
        // A rejected steer (e.g. claude's "no thread_id captured yet") is
        // shown, not swallowed — an AC-P1.5-7 requirement, and the same
        // honesty standard the rest of this app already applies.
        if (ack.detail === "revision conflict") pendingInput.current = null;
        setReplyError(steerRejectText(ack.detail));
      }
    } catch (err) {
      setReplyError(err instanceof Error ? err.message : "Antwort fehlgeschlagen");
    } finally {
      setReplyBusy(false);
    }
  };

  // T1.6-3/AC-P1.6-2: no back-arrow up top anymore — "Übersicht" in the
  // dock below is the one way back, reachable from anywhere with one tap.
  const showReply = steerSupported;
  const modelLabel =
    session.model ??
    [...events].reverse().find((event) => (event.payload as { kind?: unknown }).kind === "opencode.model")?.payload.model;
  const shownModel = typeof modelLabel === "string" ? modelLabel : null;
  const showVerlaufFilterBar = activeTab === "verlauf";

  return (
    <ApiContext.Provider value={api}>
    <div>
      <div class="topbar">
        <div style="flex: 1; min-width: 0">
          <div style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap">
            {session.project.split("/").pop()}
          </div>
          <div class="dim">
            {session.adapter}
            {shownModel ? ` · ${shownModel}` : ""} · <span class={`pill ${status}`}>{status}</span>
          </div>
        </div>
        <button class="btn" type="button" onClick={toggleArchive}>
          {archived ? "Zurückholen" : "Archivieren"}
        </button>
        <div class={`conn-dot ${conn}`} title={conn} />
      </div>

      <div class="run-strip">
        {progress &&
          (progress.percent !== null ? (
            <div class="run-progress" title="aus der To-do-Liste des Agenten">
              <div class="run-bar">
                <span style={`width: ${progress.percent}%`} />
              </div>
              <span>
                {progress.done}/{progress.total} Aufgaben · {progress.percent} %
                {progress.etaMs !== null ? ` · noch ca. ${formatMinutes(progress.etaMs)}` : ""}
              </span>
            </div>
          ) : (
            <div class="run-progress dim">läuft seit {formatMinutes(progress.elapsedMs)} · ohne Plan kein Fortschritt messbar</div>
          ))}
        <div class={`run-quota ${quota.level}`}>{quota.text}</div>
      </div>

      <div
        ref={tailRef}
        class="tail-scroll"
        style={`overflow-y: auto; max-height: ${tailMaxHeight !== null ? `${tailMaxHeight}px` : "60vh"}`}
      >
        {activeTab === "bericht" ? (
          <BerichtPane
            record={record}
            createdAt={session.createdAt}
            status={status}
            numbersReal={reportNumbersReal}
            diff={diff}
            usage={usage}
          />
        ) : activeTab === "diff" ? (
          <DiffPane diff={diff} sessionId={session.id} />
        ) : activeTab === "suche" ? (
          <SearchPane project={session.project} />
        ) : visible.length === 0 ? (
          <div class="empty">
            {status === "working" || status === "starting"
              ? `lädt…${shownModel ? ` · ${shownModel}` : ""}`
              : "keine Nachrichten"}
          </div>
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

      <div class="dock-stack" ref={dockRef}>
        <button
          class="dock-toggle"
          type="button"
          aria-label={controlsHidden ? "Steuerung einblenden" : "Steuerung ausblenden"}
          aria-expanded={!controlsHidden}
          onClick={toggleControls}
        >
          {controlsHidden ? "▴" : "▾"}
        </button>
        {!controlsHidden && (showReply || status !== "stopped") && (
          <div class="dock-actions">
            {replyError && (
              <div class="reply-error">
                {replyError}
                {leaseHeld && (
                  <button class="btn" type="button" onClick={() => void sendReply(true)} disabled={replyBusy}>
                    Übernehmen
                  </button>
                )}
              </div>
            )}
            {showReply && (
              <Composer
                value={reply}
                onChange={setReply}
                placeholder="Antworten…"
                disabled={replyBusy}
                adapter={session.adapter}
                project={session.project}
                extraActions={
                  <>
                    <button
                      class={replyBusy ? "btn primary busy" : "btn primary"}
                      aria-busy={replyBusy}
                      onClick={() => void sendReply()}
                      disabled={replyBusy || !reply.trim()}
                    >
                      {replyBusy ? "lädt…" : status === "stopped" ? "Weiter" : "Senden"}
                    </button>
                    {status !== "stopped" && (
                      <button class="btn danger" onClick={stop}>
                        Stop
                      </button>
                    )}
                  </>
                }
              />
            )}
            {!showReply && status !== "stopped" && (
              <div class="composer-actions">
                <button class="btn danger" onClick={stop}>
                  Stop
                </button>
              </div>
            )}
          </div>
        )}
        {/* AC-P1.6-2: this sub-filter used to sit right under the topbar
         * (top ~15% zone) — moved down here so every control, not just the
         * dock/tabs, lives in the thumb zone. */}
        {!controlsHidden && showVerlaufFilterBar && (
          <div class="filter-bar dock-filter-bar">
            {FILTERS.filter((f) => f.id !== "lesen").map((f) => (
              <button key={f.id} class={`chip ${filter === f.id ? "active" : ""}`} onClick={() => setFilter(f.id)}>
                {f.label}
              </button>
            ))}
          </div>
        )}
        <div class="subtabs-wrap">
          <button class={activeTab === "chat" ? "active" : ""} onClick={showChatTab}>
            Chat
          </button>
          <button class={activeTab === "verlauf" ? "active" : ""} onClick={showVerlaufTab}>
            Verlauf
          </button>
          <button class={activeTab === "bericht" ? "active" : ""} onClick={showBerichtTab}>
            Bericht
          </button>
          <button class={activeTab === "diff" ? "active" : ""} onClick={showDiffTab}>
            Diff
          </button>
          <button class={activeTab === "suche" ? "active" : ""} onClick={showSucheTab}>
            Suche
          </button>
        </div>
        <GlobalDock active={null} onNavigate={onNavigate} onVoice={() => setVoiceOpen(true)} />
      </div>
      <VoiceSheet open={voiceOpen} onClose={() => setVoiceOpen(false)} sessionId={session.id} />
    </div>
    </ApiContext.Provider>
  );
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "n/a";
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes} min ${seconds} s` : `${seconds} s`;
}

/**
 * T1.6-4 — every row here has a named, real source (EPIC-P1.6 §3.3); "Tests"
 * has none today (no adapter emits a structured pass/fail signal, only free
 * text inside tool_result payloads) and says so instead of guessing (R9.7).
 * Kontingent-Wirkung is deliberately the adapter's CURRENT account-wide
 * snapshot, not a per-session before/after delta — computing a true delta
 * needs a "usage at session start" capture that doesn't exist yet; showing
 * the current snapshot honestly labeled beats a half-built delta.
 */
/**
 * T2.7 (EPIC-P2 §3 "Budget-Top-up (write-Klasse)") — shown only on a
 * session parked FOR BUDGET (ADR-0008's parkReason, never a manual park).
 * Success message differs depending on whether this hub gates it behind
 * an approval (still pending) or applied it immediately.
 */
function BudgetTopUp({ sessionId, currentBudgetUsd }: { sessionId: string; currentBudgetUsd: number | null }) {
  const api = useApi();
  const [amount, setAmount] = useState(String(((currentBudgetUsd ?? 1) * 2).toFixed(2)));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const submit = async () => {
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) return;
    setBusy(true);
    setMessage("");
    try {
      await api.requestBudgetTopUp(sessionId, value);
      setMessage("Budget erhöht — Session läuft weiter.");
    } catch (err) {
      // A pending-approval response (422) throws here (see api.ts) — the
      // exact reason is still worth showing even though it's a real
      // request that succeeded in queuing, not a failure.
      setMessage(err instanceof Error ? err.message : "fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="card" style="margin: 10px 0; display: grid; gap: 8px">
      <div>Session wegen Budget pausiert.</div>
      <div style="display: flex; gap: 8px; align-items: center">
        <input
          type="number"
          step="0.01"
          min="0"
          value={amount}
          onInput={(e) => setAmount((e.target as HTMLInputElement).value)}
          style="width: 100px"
        />
        <span>$ neues Budget</span>
      </div>
      <button class={busy ? "btn primary busy" : "btn primary"} aria-busy={busy} onClick={submit} disabled={busy}>
        {busy ? "lädt…" : "Budget erhöhen"}
      </button>
      {message && <div class="dim" style="font-size: 12px">{message}</div>}
    </div>
  );
}

function BerichtPane({
  record,
  createdAt,
  status,
  numbersReal,
  diff,
  usage,
}: {
  record: SessionRecord;
  createdAt: string;
  status: string;
  numbersReal: boolean;
  diff: SessionDiffResult | null;
  usage: AdapterUsage | null;
}) {
  const running = status !== "stopped" && status !== "error";
  const durationMs = new Date(record.updatedAt).getTime() - new Date(createdAt).getTime();
  const suffix = running ? " (bisher)" : "";
  const filesChanged = diff ? (diff.error ? diff.error : `${diff.files.length}${suffix}`) : "lädt …";

  return (
    <div>
      <span class={`status-chip ${running ? "pending" : "done"}`}>{running ? "● läuft" : "✓ abgeschlossen"}</span>
      {status === "parked" && record.parkReason === "budget" && <BudgetTopUp sessionId={record.id} currentBudgetUsd={record.budgetUsd} />}
      <div class="kv-list">
        <div class="kv-row">
          <span class="k">Dauer</span>
          <span class="v num">
            {formatDuration(durationMs)}
            {suffix}
          </span>
        </div>
        <div class="kv-row">
          <span class="k">Kosten</span>
          <span class="v num">{numbersReal ? `${formatUsd(record.costUsd)}${suffix}` : "nicht erfasst"}</span>
        </div>
        <div class="kv-row">
          <span class="k">Tokens</span>
          <span class="v num">
            {numbersReal ? `${record.tokensEst.toLocaleString("de-DE")}${suffix}` : "nicht erfasst"}
          </span>
        </div>
        <div class="kv-row">
          <span class="k">Kontingent (Adapter-weit)</span>
          <span class="v num">
            {!usage || !usage.supported
              ? "unbekannt"
              : usage.quota === null
                ? "noch keine Meldung"
                : usage.quota.windows.map(formatWindow).join(" · ")}
          </span>
        </div>
        <div class="kv-row">
          <span class="k">Dateien geändert</span>
          <span class="v num">{filesChanged}</span>
        </div>
        <div class="kv-row">
          <span class="k">Tests</span>
          <span class="v dim">nicht erfasst — kein Adapter meldet ein strukturiertes Test-Signal</span>
        </div>
      </div>
      {record.attachCmd && <AttachCmdRow cmd={onHost(record.attachCmd, remoteHost(record.hostId))} />}
      {record.worktree && (
        <WorktreeCard sessionId={record.id} status={status} worktree={record.worktree} project={record.project} host={remoteHost(record.hostId)} />
      )}
      <ContinueCard openCmd={record.openCmd ? onHost(record.openCmd, remoteHost(record.hostId)) : undefined} host={remoteHost(record.hostId)} />
    </div>
  );
}

/**
 * Real user request (2026-09-19): "same session on the phone and my
 * desktop terminal" — this genuinely is the same worker process, not a
 * copy; typing in the attached tmux pane and watching it here (or vice
 * versa) both observe/drive the one real thing.
 *
 * Real, found-live caveat: for a one-shot/turn-based adapter (claude,
 * codex, opencode, copilot — a new CLI process per turn, not one
 * long-lived process for the whole session), the real tmux pane only
 * exists WHILE a turn is actively running; `TmuxRunner` cleans it up the
 * moment that turn's process exits (verified live: a session sat
 * "working" — genuinely waiting for the next prompt, not broken — with
 * no real tmux session left at all seconds after its last turn
 * finished). The command shown here is always real, correct syntax; it's
 * only actually attachable in that window. `tmux attach`'s own "session
 * not found" is an honest, self-explanatory outcome in that case — not a
 * fabricated promise, just said plainly rather than pretending it
 * always works.
 */
/** Copy button that says whether the copy really happened. */
function CopyButton({ text }: { text: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
    } catch {
      // Clipboard needs a secure context; the text stays selectable.
      setState("failed");
    }
    setTimeout(() => setState("idle"), 1500);
  };
  return (
    <button class="btn" type="button" onClick={() => void copy()}>
      {state === "copied" ? "Kopiert" : state === "failed" ? "Bitte markieren" : "Kopieren"}
    </button>
  );
}

function shellQuote(value: string): string {
  return /^[\w./=@%^+:-]+$/.test(value) ? value : `'${value.replaceAll("'", `'\\''`)}'`;
}

/** EPIC-P6 T6.6: a command for another host of the fleet runs there, via SSH
 * with the host id as name (the tailnet name of that machine). */
export function onHost(command: string, host: string | null): string {
  return host ? `ssh -t ${host} ${shellQuote(command)}` : command;
}

/** Changes of an isolated session are in its worktree, not the project
 * folder the editor shows — say so, and how to open it. */
function WorktreeCard({
  sessionId,
  status,
  worktree,
  project,
  host = null,
}: {
  sessionId: string;
  status: string;
  worktree: { path: string; branch: string };
  project: string;
  host?: string | null;
}) {
  const api = useApi();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const running = status === "working" || status === "starting";
  const projectName = project.split("/").pop() ?? project;
  const apply = async () => {
    setBusy(true);
    try {
      const r = await api.applyToProject(sessionId);
      setResult(
        r.ok
          ? { ok: true, text: `Übernommen: ${r.files} Datei(en) nach ${r.into} (${r.commit}).` }
          : { ok: false, text: r.detail ?? "Übernehmen fehlgeschlagen." },
      );
    } catch (err) {
      setResult({ ok: false, text: err instanceof Error ? err.message : "Übernehmen fehlgeschlagen." });
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };
  const openInEditor = host ? `code --remote ssh-remote+${host} ${shellQuote(worktree.path)}` : `code ${shellQuote(worktree.path)}`;
  return (
    <div class="card worktree-card">
      <div class="dim" style="font-size: 12px; margin-bottom: 6px">
        Die Änderungen dieser Session liegen in einem eigenen Git-Worktree{host ? ` auf ${host}` : ""}, nicht in {project.split("/").pop()}.
        Branch <span class="mono">{worktree.branch}</span>.
      </div>
      <div class="attach-cmd-row">
        <code class="mono worktree-path">{worktree.path}</code>
        <CopyButton text={worktree.path} />
      </div>
      <div class="attach-cmd-row" style="margin-top: 6px">
        <code class="mono worktree-open">{openInEditor}</code>
        <CopyButton text={openInEditor} />
      </div>
      {confirming ? (
        <div class="apply-confirm">
          <div class="dim" style="font-size: 12px">
            Committet alle Änderungen auf {worktree.branch} und merged sie in den ausgecheckten Branch von {projectName}.
          </div>
          <div class="row" style="gap: 8px">
            <button class={busy ? "btn primary busy" : "btn primary"} type="button" disabled={busy} onClick={() => void apply()}>
              {busy ? "lädt…" : "Jetzt übernehmen"}
            </button>
            <button class="btn" type="button" disabled={busy} onClick={() => setConfirming(false)}>
              Abbrechen
            </button>
          </div>
        </div>
      ) : (
        <button
          class="btn apply-btn"
          type="button"
          disabled={running}
          title={running ? "Erst nach dem laufenden Zug" : undefined}
          onClick={() => {
            setResult(null);
            setConfirming(true);
          }}
        >
          Ins Projekt übernehmen
        </button>
      )}
      {result && <div class={result.ok ? "apply-result ok" : "apply-result reply-error"}>{result.text}</div>}
    </div>
  );
}

/**
 * T5.5: continue elsewhere — the web link to this very session (AC-P5-5)
 * and, between turns, the native terminal command for the same provider
 * session on the PC. The hub hides the command while a turn runs, so hub
 * and terminal never write at the same time.
 */
function ContinueCard({ openCmd, host = null }: { openCmd?: string | undefined; host?: string | null }) {
  const link = typeof location === "undefined" ? "" : location.href;
  return (
    <div class="card continue-card">
      <div class="dim" style="font-size: 12px; margin-bottom: 6px">Weiterarbeiten auf einem anderen Gerät</div>
      <div class="attach-cmd-row">
        <code class="mono continue-link">{link}</code>
        <CopyButton text={link} />
      </div>
      {openCmd ? (
        <>
          <div class="dim" style="font-size: 12px; margin: 8px 0 6px">
            {host ? `Im Terminal, per SSH auf ${host}` : "Im Terminal am PC"}, dieselbe Provider-Session. Solange sie dort läuft, hier nichts senden.
          </div>
          <div class="attach-cmd-row">
            <code class="mono continue-open">{openCmd}</code>
            <CopyButton text={openCmd} />
          </div>
        </>
      ) : (
        <div class="dim continue-none" style="font-size: 11px; margin-top: 6px">
          Terminal-Befehl erscheint zwischen zwei Zügen, sobald die Provider-Session bekannt ist.
        </div>
      )}
    </div>
  );
}

function AttachCmdRow({ cmd }: { cmd: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(cmd);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard API unavailable (e.g. insecure context) — the command
      // is still shown and selectable by hand, never a dead end.
    }
  };
  return (
    <div class="card attach-cmd-card">
      <div class="dim" style="font-size: 12px; margin-bottom: 6px">
        Am Desktop weiterarbeiten — dieselbe Session, nicht eine Kopie. Funktioniert
        sicher, während der Agent gerade aktiv einen Zug ausführt; dazwischen evtl.
        „session not found", falls gerade kein Prozess läuft:
      </div>
      <div class="attach-cmd-row">
        <code class="mono">{cmd}</code>
        <button class="btn" onClick={copy}>
          {copied ? "Kopiert" : "Kopieren"}
        </button>
      </div>
    </div>
  );
}

/**
 * T1.6-5 → T2.3 (EPIC-P2 §4): per-file hunk cards, replacing the raw
 * concatenated-patch view. Each hunk shows git's own real function-context
 * anchor (T2.2) and, once collapsed under K3, a tap-to-expand button that
 * fetches the full hunk via GET /api/sessions/:id/diff/hunk.
 */
function diffLineClass(line: string): string {
  if (line.startsWith("+++") || line.startsWith("---")) return "diff-line-file";
  if (line.startsWith("+")) return "diff-line-add";
  if (line.startsWith("-")) return "diff-line-del";
  if (line.startsWith("@@")) return "diff-line-hunk";
  if (line.startsWith("diff --git")) return "diff-line-header";
  return "diff-line-ctx";
}

interface SplitCell {
  type: "ctx" | "add" | "del" | "empty";
  text: string;
}
interface SplitRow {
  left: SplitCell;
  right: SplitCell;
}

/**
 * Unified hunk body → side-by-side rows (T2.3 "Querformat side-by-side").
 * Classic run-pairing: consecutive `-` lines are paired against the
 * consecutive `+` lines that follow them, index by index, empty cells
 * filling whichever side ran out first; a context line flushes any
 * pending run and appears on both sides unchanged.
 */
function pairHunkLines(body: string): SplitRow[] {
  const rows: SplitRow[] = [];
  let delBuf: string[] = [];
  let addBuf: string[] = [];
  const flush = () => {
    const n = Math.max(delBuf.length, addBuf.length);
    for (let i = 0; i < n; i++) {
      rows.push({
        left: i < delBuf.length ? { type: "del", text: delBuf[i]! } : { type: "empty", text: "" },
        right: i < addBuf.length ? { type: "add", text: addBuf[i]! } : { type: "empty", text: "" },
      });
    }
    delBuf = [];
    addBuf = [];
  };
  for (const line of body.split("\n")) {
    if (line.startsWith("-")) delBuf.push(line.slice(1));
    else if (line.startsWith("+")) addBuf.push(line.slice(1));
    else if (line.startsWith("\\")) continue; // "\ No newline at end of file"
    else {
      flush();
      const text = line.startsWith(" ") ? line.slice(1) : line;
      rows.push({ left: { type: "ctx", text }, right: { type: "ctx", text } });
    }
  }
  flush();
  return rows;
}

function HunkCard({
  sessionId,
  path,
  hunk,
  index,
}: {
  sessionId: string;
  path: string;
  hunk: DiffHunk;
  index: number;
}) {
  const api = useApi();
  const [expanded, setExpanded] = useState<DiffHunk | null>(null);
  const [loading, setLoading] = useState(false);
  const active = expanded ?? hunk;
  const rows = useMemo(() => pairHunkLines(active.body), [active.body]);

  const onExpand = async () => {
    setLoading(true);
    try {
      const res = await api.sessionDiffHunk(sessionId, path);
      const full = res.hunks[index];
      if (full) setExpanded(full);
    } catch {
      // stays collapsed — a failed expand is a no-op, not a crash
    } finally {
      setLoading(false);
    }
  };

  return (
    <div class="hunk-card">
      <div class="hunk-card-header mono">
        <span class="hunk-range">
          -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines}
        </span>
        <span class="hunk-fn">{active.functionContext ?? "—"}</span>
        {active.collapsed && (
          <button class={loading ? "hunk-expand-btn busy" : "hunk-expand-btn"} aria-busy={loading} onClick={onExpand} disabled={loading}>
            {loading ? "lädt…" : "ganzer Hunk"}
          </button>
        )}
      </div>
      <div class="hunk-body-unified mono">
        {active.body.split("\n").map((line, i) => (
          <div key={i} class={diffLineClass(line)}>
            {line}
          </div>
        ))}
      </div>
      <div class="hunk-body-split mono">
        {rows.map((row, i) => (
          <div class="hunk-split-row" key={i}>
            <span class={`hunk-split-cell ${row.left.type}`}>{row.left.text}</span>
            <span class={`hunk-split-cell ${row.right.type}`}>{row.right.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function DiffPane({ diff, sessionId }: { diff: SessionDiffResult | null; sessionId: string }) {
  if (diff === null) return <div class="empty">lädt …</div>;
  if (diff.error) return <div class="empty">{diff.error}</div>;
  return (
    <div>
      <div class="diff-files">
        {diff.files.map((f) => (
          <div key={f.path} class="diff-file-row">
            <span class="mono">{f.path}</span>
            {f.binary ? (
              <span class="dim">binär</span>
            ) : (
              <span>
                <span class="diff-add-count">+{f.additions}</span> <span class="diff-del-count">-{f.deletions}</span>
              </span>
            )}
          </div>
        ))}
      </div>
      {diff.truncated && (
        <div class="dim" style="margin: 8px 0">
          Große Hunks gekürzt — „ganzer Hunk" antippen, um einen einzelnen vollständig zu laden.
        </div>
      )}
      {diff.files.map((f) =>
        f.binary || f.hunks.length === 0 ? null : (
          <div key={f.path} class="diff-file-group">
            <div class="diff-file-heading mono">{f.path}</div>
            {f.hunks.map((h, i) => (
              <HunkCard key={`${f.path}:${i}`} sessionId={sessionId} path={f.path} hunk={h} index={i} />
            ))}
          </div>
        ),
      )}
    </div>
  );
}

function toolAnchor(toolId: string, side: "use" | "result"): string {
  return `tool-${side}-${toolId}`;
}

function eventDetail(event: NormalizedEvent): string {
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

function EventDetail({ event }: { event: NormalizedEvent }) {
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

function onCardClick(ev: { target: EventTarget | null }, toggle: () => void) {
  const target = ev.target as HTMLElement | null;
  if (target?.closest("button, a")) return;
  toggle();
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
  // traceable in the tail — sessionmanager.ts stashes it on the
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
