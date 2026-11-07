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
}: {
  page: ListPage;
  onClose: () => void;
  onOpen: (session: SessionRecord) => void;
  onSwitchToken: () => void;
}) {
  const hub = useHubStatus();
  useEffect(() => {
    // A dialog inside the pane (colour picker, T34.5) handles Esc itself and marks the event.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const title = TITLES[page] ?? "";
  return (
    <section class="tool-pane" aria-label={title}>
      <header class="tool-pane-head">
        <h2>{title}</h2>
        <button type="button" class="tool-pane-close" aria-label="Schließen" title="Schließen (Esc)" onClick={onClose}>
          ×
        </button>
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
