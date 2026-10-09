import { Fragment } from "preact";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import { ApiContext } from "../../shared/api-context.ts";
import { getToken, hostApi, remoteHost, newInputId, steerRejectText, type SessionRecord, type AdapterUsage, type SessionDiffResult, type AttachmentRecord, type HarnessFeatures } from "../../shared/api.ts";
import { connectTail, type NormalizedEvent, type TailConnection } from "../../shared/ws.ts";
import { Composer } from "../composer/Composer.tsx";
import { SessionConfigure } from "./SessionConfigure.tsx";
import { QueueList } from "./QueueList.tsx";
import { PcOpenNotice } from "./PcOpenNotice.tsx";
import type { Page } from "../../app/Dock.tsx";
import { VoiceSheet } from "../voice/VoiceSheet.tsx";
import { SearchPane } from "../search/Search.tsx";
import { CodePane } from "../code/CodePane.tsx";
import { statusLabel } from "../../shared/status.ts";
import { registerField, setHere, touchField } from "../../shared/command-context.ts";
import { useDraft } from "./draft.ts";
import { takeHandOver } from "../../shared/media.ts";
import { openCommandBar } from "../commands/CommandBar.tsx";
import { getSeen, markSeen, seenKey } from "../../shared/seen.ts";
import { loadTail, saveTail } from "./tail-cache.ts";
import { ReplyTemplates } from "./ReplyTemplates.tsx";
import type { CodeTarget } from "../../app/route.ts";
import { formatMinutes, quotaSummary, runProgress } from "./run-progress.ts";
import { turnTokenStats, turnsClosedBetween, contextText, contextLevel, contextWindowFromEvents } from "./run-stats.ts";
import { type FilterPreset, FILTERS, loadFilter, toolIdOf } from "./event-filter.ts";
import { EventRow } from "./EventRow.tsx";
import { DiffPane } from "./DiffPane.tsx";
import { ReportPane } from "./ReportPane.tsx";
import { SessionApprovals } from "./SessionApprovals.tsx";

/** BUG-0053: below this window height (landscape) the dock is compacted and the controls start folded. */
const SHORT_VIEWPORT_PX = 520;

export function SessionTail({ session, onNavigate, initialCode }: { session: SessionRecord; onNavigate: (page: Page) => void; initialCode?: CodeTarget }) {
  // EPIC-P6: every call of this view goes to the session's own host.
  const api = useMemo(() => hostApi(session.hostId), [session.hostId]);
  const [events, setEvents] = useState<NormalizedEvent[]>([]);
  // T8.2: what this device saw last — until live events arrive.
  const hostKey = remoteHost(session.hostId) ?? "local";
  const [cached] = useState(() => loadTail(hostKey, session.id));
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);
  useEffect(() => {
    const t = setTimeout(() => saveTail(hostKey, session.id, events), 1000);
    return () => clearTimeout(t);
  }, [events]);
  const shownEvents = events.length === 0 && cached ? cached.events : events;
  // T8.6: where "new since your last visit" starts (null: nothing new / never here).
  const seenAt = useRef(getSeen(seenKey(session.hostId ?? "", session.id)));
  useEffect(() => {
    const last = events.at(-1)?.seq;
    if (last === undefined) return;
    const t = setTimeout(() => markSeen(seenKey(session.hostId ?? "", session.id), last), 1500);
    return () => clearTimeout(t);
  }, [events]);
  const fromCache = events.length === 0 && cached !== null;
  const [conn, setConn] = useState<"connecting" | "live" | "reconnecting" | "closed">("connecting");
  const [filter, setFilter] = useState<FilterPreset>(loadFilter);
  const [status, setStatus] = useState(session.status);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const tailRef = useRef<HTMLDivElement>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  // BUG-0043: nur wer unten liest, wird mit neuen Events nach unten geführt.
  const stickRef = useRef(true);
  const userInputAt = useRef(0);
  // The tail ends exactly where the fixed controls start — measured, not
  // guessed: a taller composer (draft, recommendation, error) used to cover
  // the last message.
  const [tailMaxHeight, setTailMaxHeight] = useState<number | null>(null);
  // BUG-0053: in a low window (landscape) the controls start folded away — one tap on ▴ brings them back.
  // A choice the person made is kept.
  const [controlsHidden, setControlsHidden] = useState(() => {
    const stored = localStorage.getItem("uacc.controlsHidden");
    return stored === null ? window.innerHeight < SHORT_VIEWPORT_PX : stored === "1";
  });
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
  const [activeTab, setActiveTab] = useState<"chat" | "verlauf" | "bericht" | "diff" | "suche" | "code">(() =>
    initialCode ? "code" : loadFilter() === "lesen" ? "chat" : "verlauf",
  );

  // T1.5-6: the PWA could watch and stop a session, but never reply to
  // one — POST /api/sessions/:id/steer existed server-side and both real
  // adapters implement it, nothing in the client ever called it.
  const [steerSupported, setSteerSupported] = useState(false);
  /** T7.5: an observer (clip) cannot stop the harness — only stop watching. */
  const [observerOnly, setObserverOnly] = useState(false);
  // T1.6-4: claude's result line is the one real source for both costUsd
  // and tokensEst (ADR-0006) — reusing capabilities().cost as the signal
  // for "this adapter's Bericht numbers are real" avoids inventing a
  // second capability flag for data that already arrives together.
  const [reportNumbersReal, setReportNumbersReal] = useState(false);
  /** ADR-0032: the model's context window — configured on the adapter,
   * without it the context chip names no percentage. */
  const [contextWindow, setContextWindow] = useState<number | null>(null);
  // T7.10: files and images for the next reply.
  const [replyAttachments, setReplyAttachments] = useState<AttachmentRecord[]>([]);
  const [reply, setReply] = useState("");
  // T8.4: the reply is a draft on this device and on the hub (ADR-0025).
  // EPIC-P10.5: a video result handed to this session (Medien → „In Session verwenden“).
  const [handedOver] = useState(() => takeHandOver(session.id));
  const draft = useDraft({ api, hostKey: remoteHost(session.hostId) ?? "local", sessionId: session.id, text: reply, setText: setReply, attachments: replyAttachments, setAttachments: setReplyAttachments, pending: handedOver });
  const [replyBusy, setReplyBusy] = useState(false);
  const [replyError, setReplyError] = useState("");
  // Same text sent again after a failure keeps its input id (BUG-0016).
  const pendingInput = useRef<{ text: string; id: string } | null>(null);
  // T5.5: another device holds the writer lease — offer to take it over.
  const [leaseHeld, setLeaseHeld] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [archived, setArchived] = useState(session.archived === true);
  const [features, setFeatures] = useState<HarnessFeatures | null>(null);
  // EPIC-P15 T15.3: neu laden, wenn etwas vorgemerkt wurde.
  const [queueTick, setQueueTick] = useState(0);

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
          setObserverOnly(info?.capabilities.features ? !info.capabilities.features.followUp && !info.capabilities.features.interrupt : false);
          setFeatures(info?.capabilities.features ?? null);
          setReportNumbersReal(info?.capabilities.cost ?? false);
          setContextWindow(typeof info?.capabilities.contextWindowTokens === "number" ? info.capabilities.contextWindowTokens : null);
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
  const showCodeTab = () => setActiveTab("code");

  // Follow new events only where they are shown — in Bericht/Diff/Suche/
  // Code a running session used to scroll the search field away (T7.6).
  useEffect(() => {
    stickRef.current = true; // neuer Tab oder neue Session beginnt unten
  }, [activeTab, session.id]);
  useEffect(() => {
    if (activeTab !== "chat" && activeTab !== "verlauf") return;
    if (stickRef.current) tailRef.current?.scrollTo({ top: tailRef.current.scrollHeight });
  }, [events, activeTab, filter]);
  // BUG-0044: ändert sich die Höhe (Dock ein-/ausgeblendet), bleibt der Fuß sichtbar.
  // BUG-0056: nicht auf Code/Suche/Bericht — dort schiebt „nach unten“ das Suchfeld aus dem Bild.
  useLayoutEffect(() => {
    if (activeTab !== "chat" && activeTab !== "verlauf") return;
    if (stickRef.current) tailRef.current?.scrollTo({ top: tailRef.current.scrollHeight });
  }, [tailMaxHeight, activeTab]);

  useEffect(() => {
    const measure = () => {
      const tail = tailRef.current;
      const dock = dockRef.current;
      if (!tail || !dock) return;
      const available = window.innerHeight - tail.getBoundingClientRect().top - dock.getBoundingClientRect().height - 8;
      setTailMaxHeight(Math.max(48, Math.floor(available))); // BUG-0053: no floor above what is free — the list must not slide under the dock
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (dockRef.current) observer.observe(dockRef.current);
    // BUG-0044: auch was über der Liste liegt (Laufleiste, Tabs, Hinweise) ändert ihre Oberkante.
    if (tailRef.current?.parentElement) observer.observe(tailRef.current.parentElement);
    window.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
      window.visualViewport?.removeEventListener("resize", measure);
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
  // ADR-0032: tokens per finished turn + the current context fill; the
  // window of the chosen model (model announce) beats the static adapter value.
  const tokenStats = useMemo(() => turnTokenStats(shownEvents), [shownEvents]);
  const windowTokens = contextWindowFromEvents(shownEvents) ?? contextWindow;
  const context = contextText(tokenStats.lastContextTokens, windowTokens);
  const tokensKnown = (record.metrics?.tokens ?? "unknown") !== "unknown" || record.tokensEst > 0;

  const toggleControls = () => {
    setControlsHidden((hidden) => {
      localStorage.setItem("uacc.controlsHidden", hidden ? "0" : "1");
      return !hidden;
    });
  };

  const visible = useMemo(() => {
    const preset = FILTERS.find((f) => f.id === filter)!;
    return shownEvents.filter(preset.keep);
  }, [shownEvents, filter]);
  const firstNew = seenAt.current !== null && seenAt.current > 0 ? visible.find((e) => e.seq > seenAt.current!) : undefined;
  const newCount = firstNew ? visible.filter((e) => e.seq >= firstNew.seq).length : 0;

  // T1.8: tool_use <-> tool_result status + anchor navigation, built from
  // the full (unfiltered) stream so a match isn't missed just because one
  // side got filtered out under the current preset.
  const toolResultByToolId = useMemo(() => {
    const map = new Map<string, NormalizedEvent>();
    for (const e of shownEvents) {
      if (e.type === "tool_result") {
        const id = toolIdOf(e);
        if (id) map.set(id, e);
      }
    }
    return map;
  }, [shownEvents]);

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

  const [title, setTitle] = useState(session.title ?? null);
  // T9.4: the text entry knows which session is open (bound to its plans).
  useEffect(() => {
    setHere({ page: "session", sessionId: session.id, hostId: session.hostId ?? null, sessionRevision: record.inputRevision ?? null });
  }, [session.id, record.inputRevision]);
  useEffect(() => () => setHere({ page: "dashboard", sessionId: null, hostId: null, sessionRevision: null }), []);
  // T9.4: "Such im Code nach …" lands here.
  useEffect(() => {
    const check = () => {
      const pending = JSON.parse(sessionStorage.getItem("uacc.pendingCodeSearch") ?? "null") as { sessionId?: string } | null;
      if (pending?.sessionId === session.id) setActiveTab("code");
    };
    check();
    window.addEventListener("uacc:code-search", check);
    return () => window.removeEventListener("uacc:code-search", check);
  }, [session.id]);
  const [pinned, setPinned] = useState(session.pinned === true);
  const [renaming, setRenaming] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const menuRef = useRef<HTMLDetailsElement>(null);
  const titleRef = useRef(titleDraft);
  titleRef.current = titleDraft;
  useEffect(() => (renaming ? registerField("session_title", { get: () => titleRef.current, set: setTitleDraft }) : undefined), [renaming]);
  const menuDo = (fn: () => void) => {
    if (menuRef.current) menuRef.current.open = false;
    fn();
  };
  const saveTitle = async () => {
    try {
      const updated = await api.setSessionMeta(session.id, { title: titleDraft });
      setTitle(updated.title ?? null);
      setRenaming(false);
    } catch (err) {
      setReplyError(err instanceof Error ? err.message : "Umbenennen fehlgeschlagen.");
    }
  };
  const togglePin = async () => {
    try {
      const updated = await api.setSessionMeta(session.id, { pinned: !pinned });
      setPinned(updated.pinned === true);
    } catch (err) {
      setReplyError(err instanceof Error ? err.message : "Anheften fehlgeschlagen.");
    }
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

  /** EPIC-P15 T15.3: Pause — hält den laufenden Zug an, die Session bleibt fortsetzbar. */
  const pause = async () => {
    try {
      const ack = await api.steer(session.id, { kind: "park" });
      if (!ack.ok) setReplyError(steerRejectText(ack.detail));
    } catch (err) {
      setReplyError(err instanceof Error ? err.message : "Pause fehlgeschlagen.");
    }
  };

  const sendReply = async (takeover = false, queue = false) => {
    if (!reply.trim() && replyAttachments.length === 0) return;
    setReplyBusy(true);
    setReplyError("");
    setLeaseHeld(false);
    try {
      if (pendingInput.current?.text !== reply) pendingInput.current = { text: reply, id: newInputId() };
      const ids = replyAttachments.map((a) => a.id);
      const ack = await api.steer(session.id, { kind: "prompt", text: reply, ...(ids.length ? { attachmentIds: ids } : {}) }, pendingInput.current.id, takeover, queue);
      if (ack.ok) {
        if (queue) setQueueTick((t) => t + 1);
        pendingInput.current = null;
        setReply("");
        setReplyAttachments([]);
        void draft.clear();
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
  // BUG-0049: "saving" is a moment between two saves, not a state worth a message — keep showing the last
  // settled one, otherwise the line folds away and back at every pause while typing and pushes the dock.
  const settledDraft = useRef<"saved" | "local" | null>(null);
  if (draft.state === "saved" || draft.state === "local") settledDraft.current = draft.state;
  else if (draft.state === "idle") settledDraft.current = null;
  const draftShown = settledDraft.current;
  const modelLabel =
    session.model ??
    [...events].reverse().find((event) => (event.payload as { kind?: unknown }).kind === "opencode.model" || (event.payload as { kind?: unknown }).kind === "acp.model")?.payload.model;
  const shownModel = typeof modelLabel === "string" ? modelLabel : null;
  const showVerlaufFilterBar = activeTab === "verlauf";

  return (
    <ApiContext.Provider value={api}>
    <div>
      {/* T8.5: back, what this is, Stop apart from Senden, the rest in ⋯ */}
      <div class="topbar session-topbar">
        <button class="btn back-btn" type="button" aria-label="Zur Übersicht" onClick={() => onNavigate("dashboard")}>
          ←
        </button>
        <div style="flex: 1; min-width: 0">
          {renaming ? (
            <form
              class="rename-form"
              onSubmit={(e) => {
                e.preventDefault();
                void saveTitle();
              }}
            >
              <input aria-label="Neuer Titel" value={titleDraft} maxLength={80} onFocus={() => touchField("session_title")} onInput={(e) => setTitleDraft((e.target as HTMLInputElement).value)} />
              <button class="btn primary" type="submit">
                OK
              </button>
            </form>
          ) : (
            <div class="session-top-title">{title ?? session.project.split("/").pop()}</div>
          )}
          <div class="dim session-top-meta">
            {session.project.split("/").pop()} · {session.adapter}
            {shownModel ? ` · ${shownModel}` : ""} · <span class={`pill ${status}`} data-status={status}>{statusLabel(status)}</span>
          </div>
        </div>
        {!observerOnly && features?.interrupt && (status === "working" || status === "starting" || status === "waiting_approval") && (
          <button class="btn pause-btn" type="button" onClick={() => void pause()}>
            Pause
          </button>
        )}
        {!observerOnly && status !== "stopped" && (
          <button class="btn danger stop-btn" type="button" onClick={stop}>
            Stop
          </button>
        )}
        <details class="session-menu" ref={menuRef}>
          <summary aria-label="Weitere Aktionen">⋯</summary>
          <div class="session-menu-items">
            <button type="button" onClick={() => menuDo(() => { setTitleDraft(title ?? ""); setRenaming(true); })}>
              Umbenennen
            </button>
            <button type="button" onClick={() => menuDo(() => void togglePin())}>
              {pinned ? "Lösen" : "Anheften"}
            </button>
            <button type="button" onClick={() => menuDo(() => void toggleArchive())}>
              {archived ? "Zurückholen" : "Archivieren"}
            </button>
            <button
              type="button"
              class="danger"
              onClick={() =>
                menuDo(() => {
                  if (!confirm("Session endgültig löschen? Verlauf, Statistik und Worktree sind weg.")) return;
                  void api
                    .deleteSession(session.id)
                    .then(() => onNavigate("dashboard"))
                    .catch((err) => setReplyError(err instanceof Error ? err.message : "Löschen fehlgeschlagen"));
                })
              }
            >
              Löschen
            </button>
            <button type="button" onClick={() => menuDo(() => setVoiceOpen(true))}>
              Sprachbefehl
            </button>
            <button type="button" onClick={() => menuDo(openCommandBar)}>
              Auftrag in Worten
            </button>
          </div>
        </details>
        <div class={`conn-dot ${conn}`} title={conn} />
      </div>

      {fromCache && cached && (
        <div class="badge-stale offline-note">
          Gespeicherter Stand vom {new Date(cached.at).toLocaleString("de-DE")}
          {online ? " — verbinde…" : " — offline"}
        </div>
      )}
      {firstNew && (
        <button type="button" class="chip new-jump" onClick={() => jumpTo("seit-letztem-besuch")}>
          ↓ {newCount} neu seit deinem letzten Besuch
        </button>
      )}
      {!online && <div class="badge-stale offline-note">Offline — Senden ist gesperrt, dein Entwurf bleibt.</div>}
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
        {(tokensKnown || context !== null) && (
          <div class={`run-tokens ${contextLevel(tokenStats.lastContextTokens, windowTokens) ?? ""}`}>
            {tokensKnown ? `Σ ${record.tokensEst.toLocaleString("de-DE")} Tokens` : "Tokens nicht gemeldet"}
            {context ? ` · ${context}` : ""}
          </div>
        )}
      </div>

      <div
        ref={tailRef}
        class="tail-scroll"
        onWheel={() => (userInputAt.current = Date.now())}
        onTouchMove={() => (userInputAt.current = Date.now())}
        onPointerDown={() => (userInputAt.current = Date.now())}
        onKeyDown={() => (userInputAt.current = Date.now())}
        onScroll={() => {
          const el = tailRef.current;
          if (!el) return;
          // Unten angekommen: wieder mitlaufen. Nach oben nur auf Nutzereingabe —
          // Layout-Änderungen lösen ebenfalls scroll-Ereignisse aus.
          if (el.scrollHeight - el.clientHeight - el.scrollTop < 48) stickRef.current = true;
          else if (Date.now() - userInputAt.current < 800) stickRef.current = false;
        }}
        style={`overflow-y: auto; max-height: ${tailMaxHeight !== null ? `${tailMaxHeight}px` : "60vh"}`}
      >
        {activeTab === "bericht" ? (
          <ReportPane
            record={record}
            createdAt={session.createdAt}
            status={status}
            numbersReal={reportNumbersReal}
            diff={diff}
            usage={usage}
            context={{ fill: tokenStats.lastContextTokens, window: windowTokens }}
          />
        ) : activeTab === "diff" ? (
          <DiffPane diff={diff} sessionId={session.id} />
        ) : activeTab === "suche" ? (
          <SearchPane project={session.project} />
        ) : activeTab === "code" ? (
          <CodePane sessionId={session.id} hostId={remoteHost(session.hostId) ?? null} {...(initialCode ? { initial: initialCode } : {})} onOpenDiff={showDiffTab} />
        ) : visible.length === 0 ? (
          <div class="empty">
            {status === "working" || status === "starting"
              ? `lädt…${shownModel ? ` · ${shownModel}` : ""}`
              : "keine Nachrichten"}
          </div>
        ) : (
          visible.map((e, i) => {
            // ADR-0032: the token bill of a turn shows under its last
            // visible row — even where the filter hides session.turn_end.
            const closed = turnsClosedBetween(tokenStats.turns, e.seq, visible[i + 1]?.seq ?? null);
            const turnTokens = closed.reduce((s, t) => s + t.tokens, 0);
            const turnFill = closed.length > 0 ? closed[closed.length - 1]!.contextTokens : null;
            return (
              <Fragment key={e.seq}>
                {e.seq === firstNew?.seq && (
                  <div class="new-divider" id="seit-letztem-besuch">
                    Neu seit deinem letzten Besuch
                  </div>
                )}
                <EventRow
                  event={e}
                  expanded={expanded.has(e.seq)}
                  onToggleExpand={() => toggleExpanded(e.seq)}
                  toolResult={e.type === "tool_use" ? toolResultByToolId.get(toolIdOf(e) ?? "") : undefined}
                  onJump={jumpTo}
                />
                {closed.length > 0 && (
                  <div class="turn-stats dim">
                    Zug {tokenStats.turns.findIndex((t) => t.endSeq === closed[0]!.endSeq) + 1}: {turnTokens.toLocaleString("de-DE")} Tokens
                    {turnFill !== null ? ` · Kontext ${turnFill.toLocaleString("de-DE")}` : ""}
                  </div>
                )}
              </Fragment>
            );
          })
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
        <SessionApprovals sessionId={session.id} api={api} />
        {!controlsHidden && !observerOnly && (
          <SessionConfigure session={record} features={features} api={api} onChanged={(patch) => setRecord((prev) => ({ ...prev, ...patch }))} />
        )}
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
                {/* T8.6: a failed send is one tap from the next try — same input id, no double turn. */}
                {!leaseHeld && online && (reply.trim() || replyAttachments.length > 0) && (
                  <button class="btn" type="button" onClick={() => void sendReply()} disabled={replyBusy}>
                    Erneut versuchen
                  </button>
                )}
              </div>
            )}
            {showReply && draft.conflict && (
              <div class="draft-conflict" role="alert">
                <div>
                  {draft.conflict.device ?? "Ein anderes Gerät"} hat den Entwurf geändert: <em>„{draft.conflict.text.slice(0, 160) || "(leer)"}“</em>
                </div>
                <div class="row">
                  <button class="btn" type="button" onClick={draft.takeTheirs}>
                    Deren übernehmen
                  </button>
                  <button class="btn primary" type="button" onClick={draft.keepMine}>
                    Meinen behalten
                  </button>
                </div>
              </div>
            )}
            {showReply && draftShown && (reply || replyAttachments.length > 0) && (
              <div class={`draft-state dim ${draftShown}`}>{draftShown === "saved" ? "Entwurf gespeichert — auch auf deinen anderen Geräten" : "Entwurf nur auf diesem Gerät (Hub nicht erreichbar)"}</div>
            )}
            {showReply && <PcOpenNotice sessionId={session.id} api={api} />}
            {showReply && <QueueList sessionId={session.id} api={api} refreshKey={queueTick} />}
            {showReply && !draft.conflict && <ReplyTemplates value={reply} onPick={setReply} />}
            {showReply && (
              <Composer
                value={reply}
                onChange={setReply}
                fieldId="reply"
                placeholder="Antworten…"
                disabled={replyBusy}
                adapter={session.adapter}
                project={session.project}
                attachments={replyAttachments}
                onAttachmentsChange={setReplyAttachments}
                extraActions={
                  <>
                    {(status === "working" || status === "starting" || status === "waiting_approval") && (
                      <button
                        class="btn"
                        type="button"
                        onClick={() => void sendReply(false, true)}
                        disabled={replyBusy || !online || (!reply.trim() && replyAttachments.length === 0)}
                      >
                        Vormerken
                      </button>
                    )}
                    <button
                      class={replyBusy ? "btn primary busy" : "btn primary"}
                      aria-busy={replyBusy}
                      onClick={() => void sendReply()}
                      disabled={replyBusy || !online || (!reply.trim() && replyAttachments.length === 0)}
                    >
                      {replyBusy ? "lädt…" : status === "stopped" || status === "parked" ? "Weiter" : "Senden"}
                    </button>
                  </>
                }
              />
            )}
            {!showReply && status !== "stopped" && (
              <div class="composer-actions">
                {observerOnly ? (
                  <>
                    <span class="observer-note">nur beobachten — der Harness läuft außerhalb des Hubs</span>
                    <button class="btn" onClick={stop}>
                      Beobachtung beenden
                    </button>
                  </>
                ) : null}
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
          <button class={activeTab === "code" ? "active" : ""} onClick={showCodeTab}>
            Code
          </button>
        </div>
      </div>
      <VoiceSheet open={voiceOpen} onClose={() => setVoiceOpen(false)} sessionId={session.id} />
    </div>
    </ApiContext.Provider>
  );
}
