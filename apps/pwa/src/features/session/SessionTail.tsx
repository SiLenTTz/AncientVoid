import { StatusNote } from "./StatusNote.tsx";
import type { ComponentChildren } from "preact";
import { InterruptedBanner } from "./InterruptedBanner.tsx";
import { copyWithRetry } from "./copy-selection.ts";
import { readTailScroll, writeTailScroll } from "./tail-scroll.ts";
import { sessionHash, fileHash } from "../../app/route.ts";
import { registerShortcut } from "../../shared/shortcuts/registry.ts";
import { sourcesBlock, sourcesOf, consumeSources, type SourceRef } from "../../shared/sources.ts";
import { HandoverBar } from "./Handover.tsx";
import { RecoveryHandover } from "./RecoveryHandover.tsx";
import { currentProviderFailure } from "./handover.ts";
import { TabIcon, type TabIconName } from "../../shared/TabIcon.tsx";
import { openPopout, postWindowMessage, useOpenWindows } from "../windows/windows.ts";
import { DetachButton } from "../windows/DetachButton.tsx";
import { VIEW_LABEL, viewKindOfTab, windowFor, type ViewTab, type WindowTarget } from "../windows/protocol.ts";
import { Fragment } from "preact";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import { ApiContext } from "../../shared/api-context.ts";
import { getToken, hostApi, remoteHost, newInputId, steerRejectText, type SessionRecord, type AdapterUsage, type SessionDiffResult, type AttachmentRecord, type HarnessFeatures, type RunEstimate } from "../../shared/api.ts";
import { connectTail, type NormalizedEvent, type TailConnection } from "../../shared/ws.ts";
import { Composer } from "../composer/Composer.tsx";
import type { SlashCommand } from "../composer/slash.ts";
import { SessionConfigure } from "./SessionConfigure.tsx";
import { WorkplaceBadge } from "./WorkplaceBadge.tsx";
import { QueueList } from "./QueueList.tsx";
import { PcOpenNotice } from "./PcOpenNotice.tsx";
import { WorkspaceRuntimePane } from "../workspace/runtime/WorkspaceRuntimePane.tsx";
import type { Page } from "../../app/Dock.tsx";
import { SearchPane } from "../search/Search.tsx";
import { CodePane } from "../code/CodePane.tsx";
import { GraphPane } from "../graph/GraphPane.tsx";
import { GitGraphPane } from "../git-graph/GitGraphPane.tsx";
import { FileViewer } from "../files/FileViewer.tsx";
import { StatusDot } from "../../shared/StatusDot.tsx";
import { useHubStatus } from "../shell/hub-status.ts";
import { getHere, registerField, setHere, touchField } from "../../shared/command-context.ts";
import { useDraft } from "./draft.ts";
import { takeHandOver } from "../../shared/media.ts";
import { getSeen, markSeen, seenKey } from "../../shared/seen.ts";
import { loadTail, saveTail } from "./tail-cache.ts";
import { QuickConfirm, lastAssistantQuestion } from "./QuickConfirm.tsx";
import { ReplyTemplates } from "./ReplyTemplates.tsx";
import type { CodeTarget } from "../../app/route.ts";
import { estimateText, formatMinutes, quotaSummary, runProgress } from "./run-progress.ts";
import { StatusLine } from "./StatusLine.tsx";
import { ChangesHead, changeSummary } from "./ChangesHead.tsx";
import { openLayer } from "../../shared/layers.ts";
import { ChatTurns, itemFirstSeq, itemLastSeq } from "./ChatTurns.tsx";
import { turnsOf } from "./turns.ts";
import { PinnedPrompt } from "./PinnedPrompt.tsx";
import { lastUserPrompt, tailWindow, useRecoveredPrompt } from "./last-prompt.ts";
import { useChatEvents } from "./event-blobs.ts";
import { LoopBadge, LoopPanel } from "../loops/LoopPanel.tsx";
import { deriveLoopView } from "../loops/loop-view.ts";
import { turnTokenStats, turnsClosedBetween, contextText, contextLevel, contextWindowFromEvents, latestModelName, tokenText } from "./run-stats.ts";
import { type FilterPreset, FILTERS, loadFilter, toolIdOf } from "./event-filter.ts";
import { EventRow } from "./EventRow.tsx";
import { DiffReview } from "./DiffReview.tsx";
import { ForgePanel } from "../forge/ForgePanel.tsx";
import { ReportPane } from "./ReportPane.tsx";
import { SessionApprovals } from "./SessionApprovals.tsx";

/** BUG-0053: below this window height (landscape) the dock is compacted and the controls start folded. */
const SHORT_VIEWPORT_PX = 520;
/** A tile without focus renders new events at most this often (K2 budget 200 ms). */
const BACKGROUND_FLUSH_MS = 50;
/** Rows a tile without focus keeps in the DOM. */
const BACKGROUND_ROWS = 150;
/** Tabs that read rather than talk: the composer folds away in a desktop tile. */
const READING_TABS: ReadonlySet<string> = new Set(["diff", "forge", "bericht", "suche", "code", "umgebung", "graph", "git", "datei"]);

/** EPIC-P18: set when this view is one tile of the desktop workspace —
 * several SessionTails then share one page. */
export interface TileContext {
  /** The focused tile owns the command context (T9.4). */
  active: boolean;
  /** A small tile starts with the controls folded away (P18 premortem 3). */
  compact: boolean;
  /** EPIC-P43 T43.6: der Kachelkopf — Griff und Nummer vorn, Herauslösen und Leeren hinten; die Reiter
   * stehen dazwischen statt in einer senkrechten Leiste. */
  head?: { start: ComponentChildren; end: ComponentChildren };
  /** EPIC-P43 T43.7 (ADR-0068): ein Ansichtsfenster zeigt genau diesen Reiter — ohne Reiter, Antwortfeld und Menü. */
  only?: ViewTab;
}

function fitSessionMenu(menu: HTMLDetailsElement | null): void {
  if (!menu?.open) return;
  const items = menu.querySelector<HTMLElement>(".session-menu-items");
  if (!items) return;
  const top = items.getBoundingClientRect().top;
  let bottom = window.visualViewport ? window.visualViewport.offsetTop + window.visualViewport.height : window.innerHeight;
  for (let parent = menu.parentElement; parent; parent = parent.parentElement) {
    if (/^(hidden|clip|auto|scroll)$/.test(getComputedStyle(parent).overflowY)) bottom = Math.min(bottom, parent.getBoundingClientRect().bottom);
  }
  const zoom = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--ui-zoom")) || 1;
  items.style.maxHeight = `${Math.max(1, bottom - top - 8) / zoom}px`;
}

export function SessionTail({
  session,
  onNavigate,
  initialCode,
  initialTab,
  initialFile,
  tile,
}: {
  session: SessionRecord;
  onNavigate: (page: Page) => void;
  initialCode?: CodeTarget;
  /** EPIC-P48 / ADR-0071: Graph-, Git- oder Datei-Tab (Hash-Routen). */
  initialTab?: "graph" | "git" | "datei";
  initialFile?: string | null;
  tile?: TileContext;
}) {
  // EPIC-P6: every call of this view goes to the session's own host.
  const api = useMemo(() => hostApi(session.hostId), [session.hostId]);
  const [events, setEvents] = useState<NormalizedEvent[]>([]);
  // 2026-10-25: click-to-expand for the run strip's todo plan (transparency).
  const [todosOpen, setTodosOpen] = useState(false);
  const [recoveryHandover, setRecoveryHandover] = useState(false);
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
      // BUG-0107: transient abgelehntes writeText wurde still geschluckt —
      // der Flash ist der Beleg fürs Kopieren, ein Einzel-Retry gehört dazu.
      if (navigator.clipboard) {
        void copyWithRetry(text, (t) => navigator.clipboard!.writeText(t))
          .then((ok) => {
            if (!ok) return; // kein Clipboard (insecure context) — Kopieren-Button bleibt der Weg
            setCopyFlash(true);
            window.clearTimeout(flashTimer);
            flashTimer = window.setTimeout(() => setCopyFlash(false), 1200);
          });
      }
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
  const tailEvents = events.length === 0 && cached ? cached.events : events;
  const recoveredPrompt = useRecoveredPrompt(tailEvents, api, session.id);
  const shownEvents = useMemo(() => recoveredPrompt.prompt ? [recoveredPrompt.prompt, ...tailEvents] : tailEvents, [tailEvents, recoveredPrompt.prompt]);
  useEffect(() => {
    const t = setTimeout(() => saveTail(hostKey, session.id, shownEvents), 1000);
    return () => clearTimeout(t);
  }, [shownEvents]);
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
  const [activeTab, setActiveTab] = useState<"chat" | "verlauf" | "bericht" | "diff" | "graph" | "git" | "datei" | "forge" | "suche" | "code" | "umgebung">(() =>
    tile?.only ?? (initialCode ? "code" : initialTab === "graph" ? "graph" : initialTab === "git" ? "git" : initialFile ? "datei" : loadFilter() === "lesen" ? "chat" : "verlauf"),
  );
  const [graphFull, setGraphFull] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  // „Mehr“ schließt bei Escape und bei einem Tipp daneben — am Handy deckt das Blatt die Reiter ab.
  // EPIC-P51 T51.5: Esc über die Shortcut-Registry; der Tipp-nebenbei-Listener bleibt lokal.
  useEffect(() => {
    if (!moreOpen) return;
    const off = registerShortcut("sessiontabs.more-close", (e) => {
      e.preventDefault();
      setMoreOpen(false);
    });
    const onDown = (e: PointerEvent) => {
      if (!(e.target as Element | null)?.closest?.(".subtabs-more-wrap")) setMoreOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    return () => {
      off();
      window.removeEventListener("pointerdown", onDown);
    };
  }, [moreOpen]);
  useEffect(() => {
    const jump = () => {
      try {
        const pending = JSON.parse(sessionStorage.getItem("ancientvoid.source-view") ?? "null") as { hash?: string; view?: string } | null;
        if (pending?.hash !== sessionHash(session.id, remoteHost(session.hostId)) || pending.view !== "forge") return;
        sessionStorage.removeItem("ancientvoid.source-view");
        setActiveTab("forge");
      } catch { sessionStorage.removeItem("ancientvoid.source-view"); }
    };
    jump();
    window.addEventListener("ancientvoid:source-jump", jump);
    return () => window.removeEventListener("ancientvoid:source-jump", jump);
  }, [session.id, session.hostId]);
  /** EPIC-P48: im Datei-Tab geöffnete Datei (Knoten-Klick aus dem Graph). */
  const [openFile, setOpenFile] = useState<string | null>(initialFile ?? null);

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
            return tailWindow(merged, 500);
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

  // T1.6-4/T1.6-5: fetched while Bericht or Diff is the open tab, not continuously — both are
  // periodic-check views, not a live stream, and share the one /diff endpoint. EPIC-P43 T43.5:
  // additionally once whenever no turn runs, so the „Änderungen“ tab knows its count (and,
  // empty, moves under „Mehr“ — Kleinkram-Regel 2).
  const [diff, setDiff] = useState<SessionDiffResult | null>(null);
  const [usage, setUsage] = useState<AdapterUsage | null>(null);
  const turnRunning = status === "working" || status === "starting";
  useEffect(() => {
    if (activeTab !== "bericht" && activeTab !== "diff" && turnRunning) return;
    let alive = true;
    api
      .sessionDiff(session.id)
      .then((d) => alive && setDiff(d))
      .catch(() => alive && setDiff(null));
    {
      api
        .adapterUsage(session.adapter)
        .then((u) => alive && setUsage(u))
        .catch(() => alive && setUsage(null));
    }
    return () => {
      alive = false;
    };
  }, [activeTab, session.id, session.adapter, turnRunning]);

  // Layout-Effekt: gespeichert im selben Commit, in dem die Wahl sichtbar wird — sonst verliert ein sofortiges Neuladen sie (BUG-0146).
  useLayoutEffect(() => {
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
  const showUmgebungTab = () => setActiveTab("umgebung");

  // Follow new events only where they are shown — in Bericht/Diff/Suche/
  // Code a running session used to scroll the search field away (T7.6).
  // EPIC-P43 AC-P43-7: gemerkte Scrollposition (Gerät) gewinnt vor „ans Ende“.
  // Restore pollt kurz + ResizeObserver: scrollHeight kann steigen, ohne dass
  // die Border-Box wächst (z. B. nachgeladenes Diff, padding in Tests).
  useEffect(() => {
    const saved = readTailScroll(session.id, activeTab);
    stickRef.current = saved === null;
    if (saved === null) return;
    let done = false;
    let raf = 0;
    let tries = 0;
    const apply = () => {
      if (done) return;
      const node = tailRef.current;
      if (!node || node.scrollHeight <= node.clientHeight + 8) return;
      node.scrollTop = saved;
      stickRef.current = false;
      done = true;
    };
    const tick = () => {
      apply();
      if (!done && ++tries < 180) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const el = tailRef.current;
    const ro = el ? new ResizeObserver(apply) : null;
    if (el && ro) ro.observe(el);
    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
    };
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
      fitSessionMenu(menuRef.current);
      const tail = tailRef.current;
      const dock = dockRef.current;
      if (!tail || !dock) return;
      // EPIC-P18: in a tile the list ends at the tile's bottom, not the window's.
      // BUG-0097: Dokument-Koordinaten statt viewport-relative — sonst friert
      // ein einmal gescrollter Zustand die Höhe ein. Und unter html-zoom
      // (ui-scale) messen die Rects visuelle Pixel: die Höhe wird deshalb
      // durch --ui-zoom geteilt, sonst läuft der Chat unter den Dock und
      // schiebt die Seite über das Viewport.
      const frame = tail.closest<HTMLElement>("[data-tile]");
      const scrollY = window.scrollY;
      const tailTop = tail.getBoundingClientRect().top + scrollY;
      const bottom = frame ? frame.getBoundingClientRect().bottom + scrollY : window.innerHeight + scrollY;
      const available = bottom - tailTop - dock.getBoundingClientRect().height - 8;
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
  // EPIC-P29 T29.6: Seq des letzten workspace.*-Events — die Umgebungsansicht
  // refresht daran (kein eigener Timer neben dem 3-s-Session-Poll).
  const workspaceSeq = useMemo(() => {
    let seq = 0;
    for (const e of events) {
      const kind = (e.payload as { kind?: unknown }).kind;
      if (typeof kind === "string" && kind.startsWith("workspace.")) seq = e.seq;
    }
    return seq;
  }, [events]);
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
  // EPIC-P43 T43.4: der Chat in Zügen — aus dem ungefilterten Strom, damit Schritte nicht verloren gehen.
  const live = status === "working" || status === "starting";
  const chat = useChatEvents(shownEvents, api);
  const lastPrompt = lastUserPrompt(shownEvents);
  const chatItems = useMemo(() => {
    const all = turnsOf(chat.events, live);
    if (!backgroundTile || all.length <= BACKGROUND_ROWS) return all;
    const recent = all.slice(-BACKGROUND_ROWS);
    const prompt = all.find((item) => item.kind === "event" && item.event.seq === lastPrompt?.seq);
    return prompt && !recent.includes(prompt) ? [prompt, ...recent.slice(1)] : recent;
  }, [chat.events, live, backgroundTile, lastPrompt]);
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

  const sendText = async (text: string, takeover = false, queue = false, submittedSources: SourceRef[] = []) => {
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
        consumeSources(session.id, submittedSources);
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

  const sendReply = (takeover = false, queue = false) => {
    // EPIC-P43.5 T43.5-1: Quellenchips wandern als markierter Block in den
    // Prompt — dieselbe Form wie die Vorschau im Composer, danach verbraucht.
    const sources = sourcesOf(session.id);
    if (sources.length === 0) return sendText(reply, takeover, queue);
    const text = `${reply}${reply.trim() ? "\n\n" : ""}${sourcesBlock(sources)}`;
    return sendText(text, takeover, queue, sources);
  };
  const running = status === "working" || status === "starting" || status === "waiting_approval";
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
  // EPIC-P43 T43.4: vier Reiter — Chat, Änderungen (Diff und Bericht), Befehle (Code, Datei), Mehr.
  // Die übrigen Ansichten liegen unter „Mehr“; ihre Adressen und Zustände bleiben dieselben.
  type Tab = typeof activeTab;
  // Kleinkram-Regel 2: ein leerer Reiter rückt unter „Mehr“ und sagt dort in einem Satz, was fehlt.
  const changed = changeSummary(diff);
  const noChanges = changed?.files === 0;
  const MAIN: { label: string; icon: TabIconName; tabs: readonly Tab[]; show: () => void; count?: number }[] = [
    { label: "Chat", icon: "chat", tabs: ["chat"], show: showChatTab },
    ...(noChanges ? [] : [{ label: "Änderungen", icon: "diff" as TabIconName, tabs: ["diff", "bericht"] as Tab[], show: showDiffTab, count: changed?.files ?? 0 }]),
    { label: "Befehle", icon: "datei", tabs: ["code", "datei"], show: showCodeTab },
  ];
  const MORE: { id: Tab; label: string; icon: TabIconName; show: () => void }[] = [
    ...(noChanges ? [{ id: "diff" as Tab, label: "Änderungen", icon: "diff" as TabIconName, show: showDiffTab }] : []),
    { id: "verlauf", label: "Verlauf", icon: "verlauf", show: showVerlaufTab },
    { id: "bericht", label: "Bericht", icon: "bericht", show: showBerichtTab },
    // Die aus dem Graph geöffnete Datei (EPIC-P48); ohne Datei sagt die Ansicht das selbst.
    { id: "datei", label: "Datei", icon: "datei", show: () => { setActiveTab("datei"); openLayer("files"); } },
    { id: "graph", label: "Graph", icon: "graph", show: () => setActiveTab("graph") },
    { id: "git", label: "Git", icon: "git", show: () => { setActiveTab("git"); location.hash = `${sessionHash(session.id, remoteHost(session.hostId))}/git`; } },
    { id: "forge", label: "GitLab", icon: "forge", show: () => setActiveTab("forge") },
    { id: "suche", label: "Suche", icon: "suche", show: showSucheTab },
    { id: "umgebung", label: "Umgebung", icon: "umgebung", show: showUmgebungTab },
  ];
  const inMore = MORE.some((m) => m.id === activeTab && !MAIN.some((t) => t.tabs.includes(m.id)));
  const tabButtons = (
    <>
      {MAIN.map((t) => {
        const on = t.tabs.includes(activeTab);
        return (
          <button key={t.label} type="button" class={on ? "active" : ""} title={t.label} aria-current={on ? "page" : undefined} onClick={() => { setMoreOpen(false); t.show(); }}>
            <TabIcon name={t.icon} />
            <span class="lb">{t.label}</span>
            {t.count ? <span class="tab-count num">{t.count}</span> : null}
          </button>
        );
      })}
      <span class="subtabs-more-wrap">
        <button type="button" class={inMore ? "active" : ""} title="Mehr" aria-haspopup="menu" aria-expanded={moreOpen} aria-current={inMore ? "page" : undefined} onClick={() => setMoreOpen((on) => !on)}>
          <TabIcon name="mehr" />
          <span class="lb">{inMore ? (MORE.find((m) => m.id === activeTab)?.label ?? "Mehr") : "Mehr"}</span>
        </button>
        {moreOpen && (
          <div class="subtabs-more" role="menu" aria-label="Weitere Ansichten">
            {MORE.map((m) => (
              <button key={m.id} type="button" role="menuitem" class={activeTab === m.id ? "active" : ""} onClick={() => { setMoreOpen(false); m.show(); }}>
                <TabIcon name={m.icon} />
                <span>{m.label}</span>
              </button>
            ))}
            {/* Ebenen über der Session (EPIC-P43, Regel 6: ohne Randlasche über dem Inhalt). */}
            <button type="button" role="menuitem" onClick={() => { setMoreOpen(false); openLayer("browser"); }}>
              <TabIcon name="browser" />
              <span>Browser</span>
            </button>
            <button type="button" role="menuitem" onClick={() => { setMoreOpen(false); openLayer("devices"); }}>
              <TabIcon name="geraete" />
              <span>Geräte</span>
            </button>
          </div>
        )}
      </span>
    </>
  );
  const showVerlaufFilterBar = activeTab === "verlauf";
  // EPIC-P43 T43.7 (ADR-0068): jede Ansicht lässt sich am PC herauslösen; läuft sie in einem Fenster,
  // steht hier ein Platzhalter mit „Fenster zeigen“ und „Zurückholen“.
  const openWindows = useOpenWindows();
  const viewKind = tile && !tile.only ? viewKindOfTab(activeTab) : null;
  const sessionHost = remoteHost(session.hostId);
  const viewTarget: WindowTarget | null = viewKind ? { kind: viewKind, sessionId: session.id, ...(sessionHost ? { hostId: sessionHost } : {}) } : null;
  const viewWindow = viewTarget ? windowFor(openWindows, viewTarget) : null;
  const detach = viewKind && viewTarget ? <DetachButton target={viewTarget} label={VIEW_LABEL[viewKind]} /> : null;
  const detachHead = detach ? <div class="view-head">{detach}</div> : null;

  return (
    <ApiContext.Provider value={api}>
    {/* 2026-10-26: the whole session view carries the same traveling border
     * as an active overview card — "this agent is working" must be visible
     * from any tab (chat/diff/code), not only from the small status pill. */}
    <div data-tab={activeTab} class={`session-live${status === "working" ? " st-working" : status === "waiting_approval" ? " st-waiting" : ""}${graphFull ? " graph-full" : ""}`}>{copyFlash && <div class="copy-flash" role="status">In Zwischenablage kopiert</div>}
      <div class="session-main">
      {/* T8.5: back, what this is, Stop apart from Senden, the rest in ⋯ */}
      <div class={`topbar session-topbar${tile ? " tile-top" : ""}`}>
        {tile?.head?.start}
        <button class="btn back-btn" type="button" aria-label="Zur Übersicht" title="Zur Übersicht" onClick={() => onNavigate("dashboard")}>
          ←
        </button>
        <div class="session-top-main">
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
            <LiveStatus sessionId={session.id} status={status} />
            {session.controlMode !== "mirror" && <>{" · "}<WorkplaceBadge session={record} /></>}
          </div>
        </div>
        {tile && !tile.only && <nav class="subtabs-wrap tile-tabs" aria-label="Ansichten">{tabButtons}</nav>}
        {!tile?.only && !observerOnly && features?.interrupt && (status === "working" || status === "starting" || status === "waiting_approval") && (
          <button class="btn pause-btn" type="button" onClick={() => void pause()}>
            Pause
          </button>
        )}
        {!tile?.only && !observerOnly && status !== "stopped" && (
          <button class="btn danger stop-btn" type="button" onClick={stop}>
            Stop
          </button>
        )}
        {!tile?.only && (
        <details class="session-menu" ref={menuRef} onToggle={e => fitSessionMenu(e.currentTarget)}>
          <summary aria-label="Weitere Aktionen" title="Weitere Aktionen">⋯</summary>
          <div class="session-menu-items">
            <StatusNote sessionId={session.id} />
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
          </div>
        </details>
        )}
        <div class={`conn-dot ${conn}`} title={conn} />
        {tile?.head?.end}
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
        <StatusLine tokens={tokensKnown ? record.tokensEst : null} fill={tokenStats.lastContextTokens} windowTokens={windowTokens} quota={quota} />
      </div>

      {factoryLink?.partner && <div class="loop-note">Factory · {factoryLink.role === "driver" ? "Treiber (Chat)" : "Beobachter (Fortschritt)"} · <a href={sessionHash(factoryLink.partner, remoteHost(session.hostId))}>{factoryLink.role === "driver" ? "Fortschritt öffnen" : "Treiber-Chat öffnen"}</a></div>}
      {(status === "interrupted" || status === "error") && <InterruptedBanner failed={status === "error"} events={events} since={record.updatedAt} nativeResume={adapterResume?.hub === true} onStop={async () => {
        await stop();
      }} onHandover={() => setRecoveryHandover(true)} onResume={async () => {
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
      {recoveryHandover && <RecoveryHandover session={record} api={api} onClose={() => setRecoveryHandover(false)} onHandedOver={created => { location.hash = sessionHash(created.id, remoteHost(session.hostId)); }} />}
      {status === "working" && (() => {
        // ADR-0074/0076: begin/end-Paare zählen — der letzte Stand steht im Strom.
        let count = 0;
        const seen = new Set<string>();
        for (const e of events) {
          const p = e.payload as { kind?: string; id?: string };
          if (p?.kind === "session.activity_begin" && typeof p.id === "string") { if (!seen.has(p.id)) { seen.add(p.id); count += 1; } }
          else if (p?.kind === "session.activity_end" && typeof p.id === "string" && seen.delete(p.id)) count -= 1;
        }
        return count > 0 ? <p class="dim" role="status">Hintergrundarbeit aktiv · {count} offene Aktivität{count === 1 ? "" : "en"}</p> : null;
      })()}
      {loopView && <LoopPanel sessionId={session.id} adapter={session.adapter} view={loopView} disabled={observerOnly || status === "stopped"} api={api} onError={setReplyError} factory={factoryLink?.role && factoryLink.partner ? { role: factoryLink.role, partner: factoryLink.partner } : null} hostId={remoteHost(session.hostId) ?? null} />}

      {activeTab === "chat" && !viewWindow && lastPrompt && <PinnedPrompt event={lastPrompt} onJump={() => {
        stickRef.current = false;
        userInputAt.current = Date.now();
        tailRef.current?.querySelector(`[data-seq="${lastPrompt.seq}"]`)?.scrollIntoView({ behavior: "auto", block: "start" });
      }} />}
      {activeTab === "chat" && chat.failed && <div class="chat-load-warning" role="status">
        Einige Schrittdetails konnten nicht geladen werden. <button type="button" class="link-btn" onClick={chat.retry}>Erneut laden</button>
      </div>}
      {activeTab === "chat" && recoveredPrompt.failed && <div class="chat-load-warning" role="status">
        Der letzte Auftrag konnte nicht geladen werden. <button type="button" class="link-btn" onClick={recoveredPrompt.retry}>Erneut laden</button>
      </div>}
      <div
        ref={tailRef}
        class="tail-scroll"
        onWheel={(event) => {
          userInputAt.current = Date.now();
          if (event.deltaY < 0) stickRef.current = false;
        }}
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
          writeTailScroll(session.id, activeTab, stickRef.current ? 0 : el.scrollTop);
        }}
        style={`overflow-y: auto; max-height: ${tailMaxHeight !== null ? `calc(${tailMaxHeight}px / var(--ui-zoom, 1))` : "60vh"}`}
      >
        {viewWindow && viewKind ? (
          <div class="empty-state detached-placeholder">
            <p>{VIEW_LABEL[viewKind]} läuft in einem eigenen Fenster.</p>
            <div class="row">
              <button class="btn" type="button" onClick={() => postWindowMessage({ type: "focus", id: viewWindow.id })}>
                Fenster zeigen
              </button>
              <button class="btn" type="button" onClick={() => postWindowMessage({ type: "recall", id: viewWindow.id })}>
                Zurückholen
              </button>
            </div>
          </div>
        ) : activeTab === "bericht" ? (
          <>
          {detachHead}
          <ReportPane
            record={record}
            createdAt={session.createdAt}
            status={status}
            numbersReal={reportNumbersReal}
            diff={diff}
            usage={usage}
            context={{ fill: tokenStats.lastContextTokens, window: windowTokens }}
          />
          </>
        ) : activeTab === "diff" ? (
          <>
            <ChangesHead diff={diff} record={record} status={status} detach={detach} />
            {noChanges ? (
              <div class="empty-state">
                <p>Diese Session hat noch nichts geändert.</p>
                <button class="btn" type="button" onClick={showChatTab}>
                  Zum Chat
                </button>
              </div>
            ) : (
              <DiffReview diff={diff} session={session} />
            )}
            <section class="changes-report" aria-label="Bericht">
              <h3 class="section-title">Bericht</h3>
              <ReportPane
                record={record}
                createdAt={session.createdAt}
                status={status}
                numbersReal={reportNumbersReal}
                diff={diff}
                usage={usage}
                context={{ fill: tokenStats.lastContextTokens, window: windowTokens }}
                applyInHead
              />
            </section>
          </>
        ) : activeTab === "forge" ? (
          <>
          {detachHead}
          <ForgePanel session={session} onOpenSession={(id) => { location.hash = sessionHash(id, remoteHost(session.hostId)); }} />
          </>
        ) : activeTab === "graph" ? (
          <>
            <div class="graph-pane-tools">
              <button
                type="button"
                class="btn"
                aria-label="Graph in eigenes Fenster"
                title="In eigenes Fenster"
                onClick={() => void openPopout({ kind: "graph", sessionId: session.id, ...(remoteHost(session.hostId) ? { hostId: remoteHost(session.hostId)! } : {}) })}
              >
                ⧉ Eigenes Fenster
              </button>
            </div>
            <GraphPane
              target={`session=${encodeURIComponent(session.id)}`}
              hostId={remoteHost(session.hostId) ?? null}
              onFullscreen={setGraphFull}
              onOpenFile={(path) => {
                setOpenFile(path);
                setActiveTab("datei");
                // Deeplink wie beim Code-Tab: Back/Reload bleibt nachvollziehbar.
                location.hash = fileHash(session.id, path, remoteHost(session.hostId));
              }}
            />
          </>
        ) : activeTab === "git" ? (
          <GitGraphPane
            target={`session=${encodeURIComponent(session.id)}`}
            hostId={remoteHost(session.hostId) ?? null}
            sessionId={session.id}
          />
        ) : activeTab === "datei" ? (
          <>
            {openFile && (
              <div class="graph-pane-tools">
                <button
                  type="button"
                  class="btn"
                  aria-label="Datei in eigenes Fenster"
                  title="In eigenes Fenster"
                  onClick={() => void openPopout({ kind: "file", sessionId: session.id, path: openFile, ...(remoteHost(session.hostId) ? { hostId: remoteHost(session.hostId)! } : {}) })}
                >
                  ⧉ Eigenes Fenster
                </button>
              </div>
            )}
            {openFile ? (
              <FileViewer target={`session=${encodeURIComponent(session.id)}`} path={openFile} hostId={remoteHost(session.hostId) ?? null} sessionId={session.id} />
            ) : (
              <CodePane sessionId={session.id} hostId={remoteHost(session.hostId) ?? null} onOpenDiff={showDiffTab} />
            )}
          </>
        ) : activeTab === "suche" ? (
          <>
            {detachHead}
            <SearchPane project={session.project} />
          </>
        ) : activeTab === "code" ? (
          <>
            <div class="view-head">
              <button class="btn" type="button" aria-label="Dateibaum öffnen" title="Dateibaum (Strg+Umschalt+E)" onClick={() => openLayer("files")}>
                Dateibaum
              </button>
              {detach}
            </div>
            <CodePane sessionId={session.id} hostId={remoteHost(session.hostId) ?? null} {...(initialCode ? { initial: initialCode } : {})} onOpenDiff={showDiffTab} />
          </>
        ) : activeTab === "umgebung" ? (
          <>
            {detachHead}
            <WorkspaceRuntimePane sessionId={session.id} refreshSeq={workspaceSeq} />
          </>
        ) : activeTab === "chat" ? (
          chatItems.length === 0 ? (
            <div class="empty">{live ? `lädt…${shownModel ? ` · ${shownModel}` : ""}` : "keine Nachrichten"}</div>
          ) : (
            <ChatTurns
              key={session.id}
              sessionId={session.id}
              items={chatItems}
              expanded={expanded}
              onToggleExpand={toggleExpanded}
              onJump={jumpTo}
              firstNewSeq={firstNew?.seq ?? null}
              onOpenVerlauf={showVerlaufTab}
              after={(item, next) => {
                if (item.kind !== "event" && item.kind !== "work") return null;
                const last = item.kind === "event" ? item.event.seq : itemLastSeq(item);
                const closed = turnsClosedBetween(tokenStats.turns, last, next ? itemFirstSeq(next) : null);
                if (closed.length === 0) return null;
                const turnTokens = closed.reduce((sum, t) => sum + t.tokens, 0);
                const turnFill = closed[closed.length - 1]!.contextTokens;
                return (
                  <div class="turn-stats dim">
                    Zug {tokenStats.turns.findIndex((t) => t.endSeq === closed[0]!.endSeq) + 1}: {turnTokens.toLocaleString("de-DE")} Tokens
                    {turnFill !== null ? ` · Kontext ${turnFill.toLocaleString("de-DE")}` : ""}
                  </div>
                );
              }}
            />
          )
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

      {!tile?.only && (
      <div class="dock-stack" ref={dockRef}>
        <button
          class="dock-toggle"
          type="button"
          aria-label={controlsFolded ? "Steuerung einblenden" : "Steuerung ausblenden"}
          title={controlsFolded ? "Steuerung einblenden" : "Steuerung ausblenden"}
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
            onRepaired={async () => {
              const updated = await api.session(session.id);
              setStatus(updated.status);
              setRecord(updated);
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
                    ? () => void sendReply(false, running)
                    : undefined
                }
                attachments={replyAttachments}
                onAttachmentsChange={setReplyAttachments}
                sourceTarget={session.id}
                extraActions={
                  <>
                    {running ? (
                      // Läuft ein Zug, ersetzt Vormerken den Senden-Knopf — kein zweiter Knopf daneben.
                      <button
                        class={replyBusy ? "btn primary busy" : "btn primary"}
                        aria-busy={replyBusy}
                        type="button"
                        onClick={() => void sendReply(false, true)}
                        disabled={replyBusy || !online || (!reply.trim() && replyAttachments.length === 0)}
                      >
                        {replyBusy ? "lädt…" : "Vormerken"}
                      </button>
                    ) : (
                      <button
                        class={replyBusy ? "btn primary busy" : "btn primary"}
                        aria-busy={replyBusy}
                        onClick={() => void sendReply()}
                        disabled={replyBusy || !online || (!reply.trim() && replyAttachments.length === 0)}
                      >
                        {replyBusy ? "lädt…" : status === "stopped" || status === "parked" ? "Weiter" : "Senden"}
                      </button>
                    )}
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
      )}
      </div>
    </div>
    </ApiContext.Provider>
  );
}

/** EPIC-P43 T43.2: der Zustand im Kopf — eigener Baustein, damit die Hub-Abfrage nicht die ganze Session neu zeichnet. */
function LiveStatus({ sessionId, status }: { sessionId: string; status: string }) {
  const hub = useHubStatus();
  return <StatusDot status={status} question={hub.questionSessions.includes(sessionId)} />;
}
