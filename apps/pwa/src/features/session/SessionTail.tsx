import { InterruptedBanner } from "./InterruptedBanner.tsx";
import { sessionHash } from "../../app/route.ts";
import { HandoverBar } from "./Handover.tsx";
import { currentProviderFailure } from "./handover.ts";
import { TabIcon, type TabIconName } from "../../shared/TabIcon.tsx";
import { Fragment } from "preact";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import { ApiContext } from "../../shared/api-context.ts";
import { getToken, hostApi, remoteHost, newInputId, steerRejectText, type SessionRecord, type AdapterUsage, type SessionDiffResult, type AttachmentRecord, type HarnessFeatures, type RunEstimate } from "../../shared/api.ts";
import { connectTail, type NormalizedEvent, type TailConnection } from "../../shared/ws.ts";
import { Composer } from "../composer/Composer.tsx";
import type { SlashCommand } from "../composer/slash.ts";
import { SessionConfigure } from "./SessionConfigure.tsx";
import { QueueList } from "./QueueList.tsx";
import { PcOpenNotice } from "./PcOpenNotice.tsx";
import type { Page } from "../../app/Dock.tsx";
import { VoiceSheet } from "../voice/VoiceSheet.tsx";
import { SearchPane } from "../search/Search.tsx";
import { CodePane } from "../code/CodePane.tsx";
import { statusLabel } from "../../shared/status.ts";
import { getHere, registerField, setHere, touchField } from "../../shared/command-context.ts";
import { useDraft } from "./draft.ts";
import { takeHandOver } from "../../shared/media.ts";
import { openCommandBar } from "../commands/CommandBar.tsx";
import { getSeen, markSeen, seenKey } from "../../shared/seen.ts";
import { loadTail, saveTail } from "./tail-cache.ts";
import { QuickConfirm, lastAssistantQuestion } from "./QuickConfirm.tsx";
import { ReplyTemplates } from "./ReplyTemplates.tsx";
import type { CodeTarget } from "../../app/route.ts";
import { estimateText, formatMinutes, quotaSummary, runProgress } from "./run-progress.ts";
import { ContextBar } from "./ContextBar.tsx";
import { LoopBadge, LoopPanel } from "../loops/LoopPanel.tsx";
import { deriveLoopView } from "../loops/loop-view.ts";
import { turnTokenStats, turnsClosedBetween, contextText, contextLevel, contextWindowFromEvents, latestModelName, tokenText } from "./run-stats.ts";
import { type FilterPreset, FILTERS, loadFilter, toolIdOf } from "./event-filter.ts";
import { EventRow } from "./EventRow.tsx";
import { DiffPane } from "./DiffPane.tsx";
import { ReportPane } from "./ReportPane.tsx";
import { SessionApprovals } from "./SessionApprovals.tsx";

/** BUG-0053: below this window height (landscape) the dock is compacted and the controls start folded. */
const SHORT_VIEWPORT_PX = 520;
/** A tile without focus renders new events at most this often (K2 budget 200 ms). */
const BACKGROUND_FLUSH_MS = 50;
/** Rows a tile without focus keeps in the DOM. */
const BACKGROUND_ROWS = 150;
/** Tabs that read rather than talk: the composer folds away in a desktop tile. */
const READING_TABS: ReadonlySet<string> = new Set(["diff", "bericht", "suche", "code"]);

/** EPIC-P18: set when this view is one tile of the desktop workspace —
 * several SessionTails then share one page. */
export interface TileContext {
  /** The focused tile owns the command context (T9.4). */
  active: boolean;
  /** A small tile starts with the controls folded away (P18 premortem 3). */
  compact: boolean;
}

export function SessionTail({
  session,
  onNavigate,
  initialCode,
  tile,
}: {
  session: SessionRecord;
  onNavigate: (page: Page) => void;
  initialCode?: CodeTarget;
  tile?: TileContext;
}) {
  // EPIC-P6: every call of this view goes to the session's own host.
  const api = useMemo(() => hostApi(session.hostId), [session.hostId]);
  const [events, setEvents] = useState<NormalizedEvent[]>([]);
  // 2026-10-25: click-to-expand for the run strip's todo plan (transparency).
  const [todosOpen, setTodosOpen] = useState(false);
  // T8.2: what this device saw last — until live events arrive.
  const hostKey = remoteHost(session.hostId) ?? "local";
  const [cached] = useState(() => loadTail(hostKey, session.id));
  const [online, setOnline] = useState(() => navigator.onLine);
  // Markieren → Auto-Zwischenablage (Nutzer-Anforderung 2026-10-30): eine
  // fertige Textauswahl im Verlauf landet ohne Kopieren-Knopf in der
  // Clipboard — pointerup ist die Nutzer-Geste, die writeText erlaubt.
  // Auswahl außerhalb des Verlaufs (z. B. Eingabefeld) bleibt unberührt.
  const [copyFlash, setCopyFlash] = useState(false);
  useEffect(() => {
    let flashTimer: number | undefined;
    const onUp = () => {
      const el = tailRef.current;
      const sel = window.getSelection();
      const text = sel?.toString() ?? "";
      if (!el || !sel || !text.trim() || !el.contains(sel.anchorNode)) return;
      void navigator.clipboard
        ?.writeText(text)
        .then(() => {
          setCopyFlash(true);
          window.clearTimeout(flashTimer);
          flashTimer = window.setTimeout(() => setCopyFlash(false), 1200);
        })
        .catch(() => undefined); // kein Clipboard (insecure context) — Kopieren-Button bleibt der Weg
    };
    document.addEventListener("pointerup", onUp);
    return () => {
      document.removeEventListener("pointerup", onUp);
      window.clearTimeout(flashTimer);
    };
  }, []);
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
    if (tile) return tile.compact;
    const stored = localStorage.getItem("ancientvoid.controlsHidden");
    return stored === null ? window.innerHeight < SHORT_VIEWPORT_PX : stored === "1";
  });
  // EPIC-P18: a layout change that makes this tile small folds it too.
  const compactTile = tile?.compact;
  useEffect(() => {
    if (compactTile !== undefined) setControlsHidden(compactTile);
  }, [compactTile]);
  const connRef = useRef<TailConnection | null>(null);
  const pendingRef = useRef<NormalizedEvent[]>([]);
  /** rAF id (> 0) or negated timeout id (< 0) of the scheduled flush. */
  const flushRef = useRef<number | null>(null);
  const activeRef = useRef(tile?.active ?? true);
  activeRef.current = tile?.active ?? true;

  // T1.6-3: Chat/Verlauf are the new dock sub-tabs — Chat is exactly the
  // existing "lesen" preset, Verlauf is "ueberwachen"/"debuggen" with a
  // small switcher inside it. `filter` stays the single source of truth
  // (unchanged ancientvoid.filter localStorage key, AC-P1.6-1) so a returning
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
  /** BUG-0061: the hub's per-registration enhance support (undefined =
   * older hub, the composer falls back to its id set). */
  const [adapterEnhance, setAdapterEnhance] = useState<boolean | undefined>(undefined);
  // 2026-10-26: readable host names (own hostname / tailnet peer names).
  const [hostNames, setHostNames] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    let alive = true;
    api
      .fleet()
      .then((overview) => {
        if (!alive) return;
        const names = new Map<string, string>();
        for (const host of overview.hosts) names.set(host.hostId, host.label ?? host.hostId.slice(0, 8));
        setHostNames(names);
      })
      .catch(() => undefined); // offline: the short id stays as fallback
    return () => {
      alive = false;
    };
  }, [api]);
  // ADR-0036: the adapter's declared external continuation command.
  const [adapterResume, setAdapterResume] = useState<{ argv: string[]; ref: "native" | "token"; hub?: true } | undefined>(undefined);
  // ADR-0042: die gemeldeten Slash-Commands des Adapters fürs Antwortfeld.
  const [adapterCommands, setAdapterCommands] = useState<readonly SlashCommand[] | undefined>(undefined);
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
          setAdapterEnhance(typeof info?.enhance === "boolean" ? info.enhance : undefined);
          setAdapterResume(info?.capabilities.resume);
          setAdapterCommands(info?.capabilities.commands);
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
      // EPIC-P18 T18.6 (K2 with four tiles): one render per frame, not per
      // WS batch — a background tile at most every 100 ms. Four tiles at
      // 30 ev/s each re-rendered 120×/s and queued up behind each other.
      onEvents: (incoming) => {
        pendingRef.current.push(...incoming);
        if (flushRef.current !== null) return;
        const flush = () => {
          flushRef.current = null;
          const batch = pendingRef.current;
          pendingRef.current = [];
          setEvents((prev) => {
            const merged = [...prev, ...batch];
            return merged.length > 500 ? merged.slice(-500) : merged;
          });
        };
        flushRef.current = activeRef.current ? requestAnimationFrame(flush) : -window.setTimeout(flush, BACKGROUND_FLUSH_MS);
      },
      onState: setConn,
    });
    return () => {
      connRef.current?.close();
      const pending = flushRef.current;
      if (pending !== null) {
        if (pending < 0) clearTimeout(-pending);
        else cancelAnimationFrame(pending);
      }
      flushRef.current = null;
    };
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
    localStorage.setItem("ancientvoid.filter", filter);
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
      // EPIC-P18: in a tile the list ends at the tile's bottom, not the window's.
      const frame = tail.closest<HTMLElement>("[data-tile]");
      const bottom = frame ? frame.getBoundingClientRect().bottom : window.innerHeight;
      const available = bottom - tail.getBoundingClientRect().top - dock.getBoundingClientRect().height - 8;
      setTailMaxHeight(Math.max(48, Math.floor(available))); // BUG-0053: no floor above what is free — the list must not slide under the dock
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (dockRef.current) observer.observe(dockRef.current);
    // BUG-0044: auch was über der Liste liegt (Laufleiste, Tabs, Hinweise) ändert ihre Oberkante.
    if (tailRef.current?.parentElement) observer.observe(tailRef.current.parentElement);
    const frame = tailRef.current?.closest<HTMLElement>("[data-tile]");
    if (frame) observer.observe(frame);
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
  const providerFailure = observerOnly ? null : currentProviderFailure(events);
  const factoryLink = useMemo(() => {
    for (const e of events) {
      const p = e.payload as { kind?: string; factory?: { role?: string; partner?: string } };
      if (p.kind === "factory.linkage" && typeof p.factory?.partner === "string" && ["driver", "observer"].includes(p.factory.role ?? "")) return p.factory;
    }
    return null;
  }, [events]);
  const isLoop = session.adapter.startsWith("loop:");
  const loopView = useMemo(() => (isLoop ? deriveLoopView(events) : null), [isLoop, events]);
  // T21.3: measured turns of the same adapter/model — fetched when a turn starts, never guessed client-side.
  const [estimate, setEstimate] = useState<RunEstimate | null>(null);
  useEffect(() => {
    if (status !== "working") return;
    let alive = true;
    api.runEstimate(session.id).then((e) => alive && setEstimate(e)).catch(() => alive && setEstimate(null));
    return () => {
      alive = false;
    };
  }, [api, session.id, status === "working"]);
  const quota = quotaSummary(quotaUsage, events);
  // ADR-0032: tokens per finished turn + the current context fill; the
  // window of the chosen model (model announce) beats the static adapter value.
  const tokenStats = useMemo(() => turnTokenStats(shownEvents), [shownEvents]);
  const windowTokens = contextWindowFromEvents(shownEvents) ?? contextWindow;
  const context = contextText(tokenStats.lastContextTokens, windowTokens);
  const tokensKnown = (record.metrics?.tokens ?? "unknown") !== "unknown" || record.tokensEst > 0;

  // EPIC-P20 T20.1: in a desktop tile the reading tabs (Diff, Bericht, Suche, Code) get the
  // height of the composer too — it stays one tap away (▴), and the tab's own choice resets
  // when the tab changes. The phone view and the chat tabs keep the device's choice.
  const [openedInReadingTab, setOpenedInReadingTab] = useState(false);
  useEffect(() => setOpenedInReadingTab(false), [activeTab]);
  const readingTab = tile !== undefined && READING_TABS.has(activeTab);
  const controlsFolded = readingTab ? !openedInReadingTab : controlsHidden;

  const toggleControls = () => {
    if (readingTab) {
      setOpenedInReadingTab((v) => !v);
      return;
    }
    setControlsHidden((hidden) => {
      // A tile's fold is that tile's; the single view keeps the device choice.
      if (!tile) localStorage.setItem("ancientvoid.controlsHidden", hidden ? "0" : "1");
      return !hidden;
    });
  };

  const backgroundTile = tile !== undefined && !tile.active;
  const filtered = useMemo(() => {
    const preset = FILTERS.find((f) => f.id === filter)!;
    return shownEvents.filter(preset.keep);
  }, [shownEvents, filter]);
  // EPIC-P18 T18.6: a tile without focus keeps only its newest rows in the
  // DOM — four tiles of 500 rows each re-laid out on every update broke K2.
  // Focus brings the full history back.
  const visible = useMemo(() => (backgroundTile && filtered.length > BACKGROUND_ROWS ? filtered.slice(-BACKGROUND_ROWS) : filtered), [filtered, backgroundTile]);
  const hiddenOlder = filtered.length - visible.length;
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
    // EPIC-P18: anchors repeat across tiles — search this view only.
    tailRef.current?.querySelector(`[id="${CSS.escape(anchor)}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const [title, setTitle] = useState(session.title ?? null);
  // T9.4: the text entry knows which session is open (bound to its plans).
  // EPIC-P18: with several tiles only the focused one speaks for "here".
  const ownsHere = tile?.active ?? true;
  useEffect(() => {
    if (!ownsHere) return;
    setHere({ page: "session", sessionId: session.id, hostId: session.hostId ?? null, sessionRevision: record.inputRevision ?? null });
  }, [session.id, record.inputRevision, ownsHere]);
  useEffect(() => {
    if (!ownsHere) return;
    // Another tile may already have taken "here" in the same commit.
    return () => {
      if (getHere().sessionId === session.id) setHere({ page: "dashboard", sessionId: null, hostId: null, sessionRevision: null });
    };
  }, [ownsHere]);
  // T9.4: "Such im Code nach …" lands here.
  useEffect(() => {
    const check = () => {
      const pending = JSON.parse(sessionStorage.getItem("ancientvoid.pendingCodeSearch") ?? "null") as { sessionId?: string } | null;
      if (pending?.sessionId === session.id) setActiveTab("code");
    };
    check();
    window.addEventListener("ancientvoid:code-search", check);
    return () => window.removeEventListener("ancientvoid:code-search", check);
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

  const sendText = async (text: string, takeover = false, queue = false) => {
    if (!text.trim() && replyAttachments.length === 0) return;
    setReplyBusy(true);
    setReplyError("");
    setLeaseHeld(false);
    try {
      if (pendingInput.current?.text !== text) pendingInput.current = { text, id: newInputId() };
      const ids = replyAttachments.map((a) => a.id);
      const ack = await api.steer(session.id, { kind: "prompt", text, ...(ids.length ? { attachmentIds: ids } : {}) }, pendingInput.current.id, takeover, queue);
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

  const sendReply = (takeover = false, queue = false) => sendText(reply, takeover, queue);
  const showReply = steerSupported;
  // T1.6-3/AC-P1.6-2: no back-arrow up top anymore — "Übersicht" in the
  // dock below is the one way back, reachable from anywhere with one tap.
  // BUG-0049: "saving" is a moment between two saves, not a state worth a message — keep showing the last
  // settled one, otherwise the line folds away and back at every pause while typing and pushes the dock.
  const settledDraft = useRef<"saved" | "local" | null>(null);
  if (draft.state === "saved" || draft.state === "local") settledDraft.current = draft.state;
  else if (draft.state === "idle") settledDraft.current = null;
  const draftShown = settledDraft.current;
  const modelLabel = session.model ?? latestModelName(events);
  // 2026-10-26: the model is ALWAYS visible — the adapter's own event wins
  // (it names what really runs), then the record (session choice or the
  // registration's configured default), else the honest "Standardmodell".
  const shownModel = typeof modelLabel === "string" && modelLabel ? modelLabel : typeof session.model === "string" && session.model ? session.model : "Standardmodell";
  // Ja/Nein-Rückfrage: die letzte Assistant-Nachricht endet auf „?“ —
  // QuickConfirm bietet dann Ja/Nein, solange das Antwortfeld leer ist.
  const agentQuestion = lastAssistantQuestion(shownEvents);
  const TABS: { id: typeof activeTab; label: string; icon: TabIconName; show: () => void }[] = [
    { id: "chat", label: "Chat", icon: "chat", show: showChatTab },
    { id: "verlauf", label: "Verlauf", icon: "verlauf", show: showVerlaufTab },
    { id: "bericht", label: "Bericht", icon: "bericht", show: showBerichtTab },
    { id: "diff", label: "Diff", icon: "diff", show: showDiffTab },
    { id: "suche", label: "Suche", icon: "suche", show: showSucheTab },
    { id: "code", label: "Code", icon: "code", show: showCodeTab },
  ];
  const tabButtons = TABS.map((t) => (
    <button key={t.id} type="button" class={activeTab === t.id ? "active" : ""} title={t.label} aria-current={activeTab === t.id ? "page" : undefined} onClick={t.show}>
      <TabIcon name={t.icon} />
      <span class="lb">{t.label}</span>
    </button>
  ));
  const showVerlaufFilterBar = activeTab === "verlauf";

  return (
    <ApiContext.Provider value={api}>
    {/* 2026-10-26: the whole session view carries the same traveling border
     * as an active overview card — "this agent is working" must be visible
     * from any tab (chat/diff/code), not only from the small status pill. */}
    <div data-tab={activeTab} class={`session-live${status === "working" ? " st-working" : status === "waiting_approval" ? " st-waiting" : ""}`}>{copyFlash && <div class="copy-flash" role="status">In Zwischenablage kopiert</div>}
      {/* Desktop-Kachel: Ansichten als Icon-Leiste links, am Handy bleiben sie im Dock unten. */}
      {tile && <nav class="subtabs-wrap tile-rail" aria-label="Ansichten">{tabButtons}</nav>}
      <div class="session-main">
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
            {session.project.split("/").pop()} · {loopView ? <LoopBadge adapter={session.adapter} view={loopView} /> : session.adapter} · {loopView ? "" : `${shownModel} · `}
            {session.hostId ? (hostNames.get(session.hostId) ?? (session.hostId === "local" ? "dieser Rechner" : session.hostId.slice(0, 8))) : "dieser Rechner"} ·{" "}
            <span class={`pill ${status}`} data-status={status}>{statusLabel(status)}</span>
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
            <div class="run-progress-wrap">
              <button
                type="button"
                class="run-progress"
                title="To-do-Liste des Agenten — klicken zum Aufklappen"
                onClick={() => setTodosOpen((v) => !v)}
              >
                <div class="run-bar">
                  <span style={`width: ${progress.percent}%`} />
                </div>
                <span>
                  {todosOpen ? "▾" : "▸"} {progress.done}/{progress.total} Aufgaben · {progress.percent} %
                  {progress.etaMs !== null ? ` · noch ca. ${formatMinutes(progress.etaMs)}` : ""}
                </span>
              </button>
              {todosOpen && progress.todos.length > 0 && (
                <ol class="run-todo-list">
                  {progress.todos.map((t, idx) => (
                    <li key={idx} class={`todo-${t.status}`}>
                      <span class="todo-marker">{t.status === "completed" ? "✔" : t.status === "in_progress" || t.status === "in-progress" ? "▶" : t.status === "cancelled" ? "✖" : "○"}</span>
                      <span class={`todo-text ${t.status === "completed" ? "done" : ""}`}>{t.text}</span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          ) : (
            <div class="run-progress dim">
              läuft seit {formatMinutes(progress.elapsedMs)}
              {progress.medianTurnMs !== null
                ? ` · Zug hier meist ${formatMinutes(progress.medianTurnMs)} (${progress.turnCount} gelaufen)`
                : " · ohne Plan kein Fortschritt messbar"}
              {estimateText(estimate, progress.elapsedMs) ? ` · ${estimateText(estimate, progress.elapsedMs)}` : ""}
            </div>
          ))}
        {/* One line, never wrapping: quota, then the always-present token line
            (used tokens and free context, or that they are unknown). On a
            phone it scrolls sideways instead of taking height (AC-P8-5). */}
        {/* Tokens and context first: they are the short, important part; the quota sentence is long
            and scrolls sideways on a phone. */}
        <div class="run-meta">
          <span class={`run-tokens ${contextLevel(tokenStats.lastContextTokens, windowTokens) ?? ""}`}>
            {tokenText(tokensKnown, record.tokensEst)} · {context}
          </span>
          <span class={`run-quota ${quota.level}`}>{quota.text}</span>
        </div>
        <ContextBar fill={tokenStats.lastContextTokens} windowTokens={windowTokens} />
      </div>

      {factoryLink?.partner && <div class="loop-note">Factory · {factoryLink.role === "driver" ? "Treiber (Chat)" : "Beobachter (Fortschritt)"} · <a href={sessionHash(factoryLink.partner, remoteHost(session.hostId))}>{factoryLink.role === "driver" ? "Fortschritt öffnen" : "Treiber-Chat öffnen"}</a></div>}
      {status === "interrupted" && <InterruptedBanner events={events} since={record.updatedAt} canResume={adapterResume?.hub === true} onResume={async () => {
        const ack = await api.resumeSession(session.id);
        if (!ack.ok) throw new Error(ack.detail ?? "Fortsetzen fehlgeschlagen.");
        const updated = await api.session(session.id);
        setStatus(updated.status);
        setRecord(updated);
      }} onArchive={async () => {
        const updated = await api.setArchived(session.id, true);
        setArchived(updated.archived === true);
        setStatus(updated.status);
      }} />}
      {loopView && <LoopPanel sessionId={session.id} adapter={session.adapter} view={loopView} disabled={observerOnly || status === "stopped"} api={api} onError={setReplyError} />}

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
          <>
          {hiddenOlder > 0 && <div class="dim older-hidden">{hiddenOlder} ältere Einträge — Kachel anklicken zeigt alle</div>}
          {visible.map((e, i) => {
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
          })}
          </>
        )}
      </div>

      <div class="dock-stack" ref={dockRef}>
        <button
          class="dock-toggle"
          type="button"
          aria-label={controlsFolded ? "Steuerung einblenden" : "Steuerung ausblenden"}
          aria-expanded={!controlsFolded}
          onClick={toggleControls}
        >
          {controlsFolded ? "▴" : "▾"}
        </button>
        {controlsFolded && observerOnly && status !== "stopped" && (
          <div class="composer-actions">
            <span class="observer-note">nur beobachten — der Harness läuft außerhalb des Hubs</span>
            <button class="btn" type="button" onClick={() => void stop()}>
              Beobachtung beenden
            </button>
          </div>
        )}
        {providerFailure && (
          <HandoverBar
            failure={providerFailure}
            session={record}
            api={api}
            onHandedOver={(created) => {
              location.hash = sessionHash(created.id, remoteHost(session.hostId));
            }}
          />
        )}
        <SessionApprovals sessionId={session.id} api={api} />
        {!controlsFolded && !observerOnly && (
          <SessionConfigure session={record} features={features} api={api} onChanged={(patch) => setRecord((prev) => ({ ...prev, ...patch }))} />
        )}
        {!controlsFolded && (showReply || status !== "stopped") && (
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
            {showReply && <PcOpenNotice sessionId={session.id} api={api} resume={adapterResume} />}
            {showReply && <QueueList sessionId={session.id} api={api} refreshKey={queueTick} />}
            {showReply && !draft.conflict && <ReplyTemplates value={reply} onPick={setReply} />}
            {showReply && !draft.conflict && !reply.trim() && agentQuestion && (
              <QuickConfirm disabled={replyBusy || !online} onAnswer={(text) => void sendText(text)} />
            )}
            {showReply && (
              <Composer
                value={reply}
                onChange={setReply}
                fieldId="reply"
                placeholder="Antworten…"
                disabled={replyBusy}
                adapter={session.adapter}
                project={session.project}
                adapterEnhance={adapterEnhance}
                commands={adapterCommands}
                commandScope="steer"
                onSubmit={
                  !replyBusy && online && (reply.trim() || replyAttachments.length > 0)
                    ? () => void sendReply()
                    : undefined
                }
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
        {!controlsFolded && showVerlaufFilterBar && (
          <div class="filter-bar dock-filter-bar">
            {FILTERS.filter((f) => f.id !== "lesen").map((f) => (
              <button key={f.id} class={`chip ${filter === f.id ? "active" : ""}`} onClick={() => setFilter(f.id)}>
                {f.label}
              </button>
            ))}
          </div>
        )}
        {!tile && <nav class="subtabs-wrap" aria-label="Ansichten">{tabButtons}</nav>}
      </div>
      <VoiceSheet open={voiceOpen} onClose={() => setVoiceOpen(false)} sessionId={session.id} />
      </div>
    </div>
    </ApiContext.Provider>
  );
}
