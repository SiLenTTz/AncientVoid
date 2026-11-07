import { useEffect } from "preact/hooks";
import type { SessionRecord } from "../../shared/api.ts";
import type { ListPage } from "../../app/route.ts";
import { DesktopPage } from "../desktop/DesktopPage.tsx";
import { DiscoveryPane } from "../discovery/Discovery.tsx";
import { MediaPage } from "../media/MediaPage.tsx";
import { SettingsPage } from "../settings/SettingsPage.tsx";
import { StatusPage } from "../status/StatusPage.tsx";
import { useHubStatus } from "./hub-status.ts";

const TITLES: Partial<Record<ListPage, string>> = {
  settings: "Einstellungen",
  discovery: "Entdeckt",
  media: "Medien",
  pc: "Am PC eintippen",
  status: "Provider-Status",
};

/**
 * EPIC-P34 T34.2 (desktop only): tool pages use the detail column instead of the 420 px list column.
 * The tiles stay mounted underneath (main.tsx marks them inert) — unmounting would reconnect every
 * WebSocket and could flicker an unsent draft. Data comes from what `App` already polls.
 */
export function ToolPane({
  page,
  onClose,
  onOpen,
  onSwitchToken,
  onPopout,
  closeLabel = "Schließen",
  escCloses = true,
}: {
  page: ListPage;
  onClose: () => void;
  onOpen: (session: SessionRecord) => void;
  onSwitchToken: () => void;
  /** EPIC-P34 T34.10: die Seite in ein eigenes Fenster legen (fehlt im Fenster selbst). */
  onPopout?: () => void;
  closeLabel?: string;
  /** Im eigenen Fenster schließt Esc nichts: das Fenster gibt man mit dem Knopf zurück. */
  escCloses?: boolean;
}) {
  const hub = useHubStatus();
  useEffect(() => {
    // A dialog inside the pane (colour picker, T34.5) handles Esc itself and marks the event.
    const onKey = (e: KeyboardEvent) => {
      if (escCloses && e.key === "Escape" && !e.defaultPrevented) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, escCloses]);
  const title = TITLES[page] ?? "";
  return (
    <section class="tool-pane" aria-label={title}>
      <header class="tool-pane-head">
        <h2>{title}</h2>
        <span class="tool-pane-actions">
          {onPopout && (
            <button type="button" class="tool-pane-popout" aria-label="In eigenem Fenster öffnen" title="In eigenem Fenster öffnen" onClick={onPopout}>
              ⧉
            </button>
          )}
          {escCloses && (
            <button type="button" class="tool-pane-close" aria-label={closeLabel} title={`${closeLabel} (Esc)`} onClick={onClose}>
              ×
            </button>
          )}
        </span>
      </header>
      <div class="tool-pane-body">
        {page === "settings" && <SettingsPage onSwitchToken={onSwitchToken} />}
        {page === "discovery" && <DiscoveryPane onOpen={onOpen} />}
        {page === "media" && <MediaPage sessions={hub.sessions} />}
        {page === "pc" && <DesktopPage />}
        {page === "status" && <StatusPage adapters={hub.adapters} usage={hub.usage} />}
      </div>
    </section>
  );
}
