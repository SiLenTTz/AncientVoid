export type Page = "dashboard" | "new" | "settings";

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
      <button class={`dock-item ${active === "dashboard" ? "active" : ""}`} onClick={() => onNavigate("dashboard")}>
        <span class="ic">▤</span>Übersicht
      </button>
      <button class={`dock-item ${active === "new" ? "active" : ""}`} onClick={() => onNavigate("new")}>
        <span class="ic">＋</span>Neue Session
      </button>
      <button class={`dock-item ${active === "settings" ? "active" : ""}`} onClick={() => onNavigate("settings")}>
        <span class="ic">⚙</span>Einstellungen
      </button>
    </nav>
  );
}
