import { useEffect, useState } from "preact/hooks";
import { hubApi, type AdapterInfo, type AdapterUsage, type FleetHost, type SessionRecord } from "../shared/api.ts";
import { Dashboard } from "../features/overview/Dashboard.tsx";
import { GlobalDock, type Page } from "./Dock.tsx";
import { pageHash } from "./route.ts";
import { VoiceSheet } from "../features/voice/VoiceSheet.tsx";
import { ApprovalQueuePane } from "../features/approvals/Approvals.tsx";
import { StatusPage } from "../features/status/StatusPage.tsx";
import { DiscoveryPane } from "../features/discovery/Discovery.tsx";
import { FleetSettings } from "../features/fleet/Fleet.tsx";
import { GeminiSettings } from "../features/settings/GeminiSettings.tsx";
import { Settings } from "../features/settings/Settings.tsx";
import { CreateSession } from "../features/new-session/CreateSession.tsx";

export function App({
  onOpen,
  ready,
  page,
}: {
  onOpen: (session: SessionRecord) => void;
  ready: () => void;
  /** T8.1: the page comes from the URL (#/neu, #/status …). */
  page: Page;
}) {
  const setPage = (p: Page) => {
    location.hash = pageHash(p);
  };
  const [sessions, setSessions] = useState<SessionRecord[] | null>(null);
  // EPIC-P6: hosts of the fleet (just this hub when nothing is paired).
  const [hosts, setHosts] = useState<FleetHost[]>([]);
  const [adapters, setAdapters] = useState<AdapterInfo[]>([]);
  const [usage, setUsage] = useState<Record<string, AdapterUsage>>({});
  const [error, setError] = useState("");
  // T1.6-2: bottom-dock navigation replaces the top icon buttons ("Buttons
  // oben sind sehr schlecht zu bedienen" — real ergonomics feedback from
  // the mockup review). Settings didn't exist as a destination before.
  // T1.6-3: initialPage lets SessionTail's dock jump straight to "new" or
  // "settings" instead of always landing back on the dashboard.
  const [voiceOpen, setVoiceOpen] = useState(false);
  // T2.6: pending-approval count for the Dashboard banner. A 501 (no
  // ApprovalService configured on this hub) is a real, common state, not
  // an error to surface — same "feature genuinely absent" handling as
  // Approvals.tsx itself.
  const [pendingApprovals, setPendingApprovals] = useState(0);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const [fleet, a] = await Promise.all([
          // An older hub has no /api/fleet — its own list is the whole fleet.
          hubApi.fleet().catch(async () => ({ self: "", hosts: [] as FleetHost[], sessions: await hubApi.sessions() })),
          hubApi.adapters(),
        ]);
        if (!alive) return;
        setSessions(fleet.sessions);
        setHosts(fleet.hosts);
        setAdapters(a);
        setError("");
        hubApi
          .approvals("pending")
          .then((pending) => alive && setPendingApprovals(pending.length))
          .catch(() => alive && setPendingApprovals(0));
        // T1.5-3/ADR-0004: one usage snapshot per known adapter, not per
        // session — fetched alongside the existing poll, not a second
        // independent timer.
        const usageEntries = await Promise.all(
          a.map(async (adapter) => [adapter.id, await hubApi.adapterUsage(adapter.id)] as const),
        );
        if (!alive) return;
        setUsage(Object.fromEntries(usageEntries));
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : "load failed");
      }
    };
    void tick();
    const timer = setInterval(tick, 3000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  return (
    <div class="app-page">
      <div class="topbar">
        <h1>UACC</h1>
        <div style="display: flex; gap: 10px; align-items: center">
          {/* Real user feedback (2026-09-19): provider/quota detail used to
           * sit inline on the Dashboard, dominating small screens before
           * any session ever showed — moved to its own page, reached from
           * here. */}
          <button class="link-btn" onClick={() => setPage("status")} title="Provider-Status">
            Status
          </button>
          {/* Real connection health, not a decorative always-green dot — same
           * classes SessionTail already uses for its own WS status. */}
          <span class={`conn-dot ${error ? "closed" : "live"}`} title={error ? error : "verbunden"} />
        </div>
      </div>

      {error && <div class="card" style="color: var(--err)">{error}</div>}

      {page === "new" && (
        <CreateSession
          adapters={adapters}
          hosts={hosts}
          onCreated={(s) => onOpen(s)}
        />
      )}

      {page === "settings" && (
        <>
          <Settings onSwitchToken={ready} />
          <FleetSettings />
          <GeminiSettings />
        </>
      )}

      {page === "approvals" && <ApprovalQueuePane />}

      {page === "status" && <StatusPage adapters={adapters} usage={usage} />}

      {page === "discovery" && <DiscoveryPane onOpen={onOpen} />}

      {page === "dashboard" &&
        (sessions === null ? (
          <div class="empty">lade…</div>
        ) : (
          <Dashboard
            sessions={sessions}
            hosts={hosts}
            onOpen={onOpen}
            pendingApprovals={pendingApprovals}
            onOpenApprovals={() => setPage("approvals")}
            onOpenDiscovery={() => setPage("discovery")}
          />
        ))}

      <VoiceSheet open={voiceOpen} onClose={() => setVoiceOpen(false)} />

      <div class="dock-stack">
        <GlobalDock active={page} onNavigate={setPage} onVoice={() => setVoiceOpen(true)} />
      </div>
    </div>
  );
}
