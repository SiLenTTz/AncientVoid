// T2.6/T1.6-status: "approvals" and "status" are real destinations
// (App.tsx renders ApprovalQueuePane/StatusPage for them) reached
// contextually — from the Dashboard's pending-approvals banner, and from
// a header link next to the connection dot — not from the dock. The
// dock's four slots already match the T1.6 mockup exactly, and neither
// EPIC-P2 nor this UI cleanup asked for a fifth. `active` simply never
// highlights any dock button while either page is open (same as
// `active === null` inside a session tail).
export type Page = "dashboard" | "new" | "settings" | "approvals" | "status";

/**
 * T1.6-2/3: the one global bottom-nav row, shared by App.tsx (as the whole
 * dock) and SessionTail.tsx (stacked above its own Chat/Verlauf sub-tabs) —
 * one definition so both stay in sync instead of drifting copies. `active`
 * is `null` from within a session: none of the three destinations is "the
 * current page" there, same as no browser tab is highlighted while a modal
 * is open.
 */
export function GlobalDock({
  active,
  onNavigate,
  onVoice,
}: {
  active: Page | null;
  onNavigate: (page: Page) => void;
  /** T1.6-7 — opens the global voice-command sheet. Not a Page: it's an
   * overlay on top of whatever's currently showing, not a destination. */
  onVoice: () => void;
}) {
  return (
    <nav class="dock">
      <button class={`dock-item ${active === "dashboard" ? "active" : ""}`} onClick={() => onNavigate("dashboard")}>
        <span class="ic">▤</span>Übersicht
      </button>
      <button class={`dock-item ${active === "new" ? "active" : ""}`} onClick={() => onNavigate("new")}>
        <span class="ic">＋</span>Neue Session
      </button>
      <button class="dock-item" onClick={onVoice}>
        <span class="ic">◉</span>Voice
      </button>
      <button class={`dock-item ${active === "settings" ? "active" : ""}`} onClick={() => onNavigate("settings")}>
        <span class="ic">⚙</span>Einstellungen
      </button>
    </nav>
  );
}
