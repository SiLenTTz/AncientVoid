// T2.6/T1.6-status: "approvals" and "status" are real destinations
// (App.tsx renders ApprovalQueuePane/StatusPage for them) reached
// contextually — from the Dashboard's pending-approvals banner, and from
// a header link next to the connection dot — not from the dock. The
// dock's slots matched the T1.6 mockup exactly; "discovery" (2026-09-27)
// became a fifth dock item so hub-external sessions are reachable in one
// tap from every list page. EPIC-P34 T34.1: "media" took the place of the
// global voice sheet (voice lives in the session only); "pc" moved into the
// settings. `active` simply never
// highlights any dock button while either page is open (same as
// `active === null` inside a session tail).
import { TabIcon } from "../shared/TabIcon.tsx";
export type { ListPage as Page } from "./route.ts";
import type { ListPage as Page } from "./route.ts";

/**
 * T1.6-2/3: the one global bottom-nav row, shared by App.tsx (as the whole
 * dock) and SessionTail.tsx (stacked above its own Chat/Verlauf sub-tabs) —
 * one definition so both stay in sync instead of drifting copies. `active`
 * is `null` from within a session: none of the three destinations is "the
 * current page" there, same as no browser tab is highlighted while a modal
 * is open.
 */
export function GlobalDock({ active, onNavigate }: { active: Page | null; onNavigate: (page: Page) => void }) {
  return (
    <nav class="dock">
      <button class={`dock-item ${active === "dashboard" ? "active" : ""}`} title="Übersicht" onClick={() => onNavigate("dashboard")}>
        <TabIcon name="uebersicht" /><span class="lb">Übersicht</span>
      </button>
      <button class={`dock-item ${active === "new" ? "active" : ""}`} title="Neue Session" onClick={() => onNavigate("new")}>
        <TabIcon name="neu" /><span class="lb">Neue Session</span>
      </button>
      <button class={`dock-item ${active === "discovery" ? "active" : ""}`} title="Entdeckt" onClick={() => onNavigate("discovery")}>
        <TabIcon name="entdeckt" /><span class="lb">Entdeckt</span>
      </button>
      <button class={`dock-item ${active === "media" ? "active" : ""}`} title="Medien: Videos analysieren" onClick={() => onNavigate("media")}>
        <TabIcon name="medien" /><span class="lb">Medien</span>
      </button>
      <button class={`dock-item ${active === "orchestrierung" ? "active" : ""}`} title="Runs (Orchestrierung)" onClick={() => onNavigate("orchestrierung")}>
        <TabIcon name="runs" /><span class="lb">Runs</span>
      </button>
      <button class={`dock-item ${active === "vault" ? "active" : ""}`} title="Notizen (Knowledge Vault)" onClick={() => onNavigate("vault")}>
        <TabIcon name="notizen" /><span class="lb">Notizen</span>
      </button>
      <button class={`dock-item ${active === "automationen" ? "active" : ""}`} title="Automationen (Zeitpläne)" onClick={() => onNavigate("automationen")}>
        <TabIcon name="automationen" /><span class="lb">Automationen</span>
      </button>
      <button class={`dock-item ${active === "settings" ? "active" : ""}`} title="Einstellungen" onClick={() => onNavigate("settings")}>
        <TabIcon name="einstellungen" /><span class="lb">Einstellungen</span>
      </button>
    </nav>
  );
}
