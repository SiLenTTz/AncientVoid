import { useEffect, useLayoutEffect } from "preact/hooks";
import type { SessionRecord } from "../../shared/api.ts";
import type { ListPage } from "../../app/route.ts";
import { DesktopPage } from "../desktop/DesktopPage.tsx";
import { DiscoveryPane } from "../discovery/Discovery.tsx";
import { MediaPage } from "../media/MediaPage.tsx";
import { SettingsPage } from "../settings/SettingsPage.tsx";
import { StatusPage } from "../status/StatusPage.tsx";
import { VaultPane } from "../vault/VaultPane.tsx";
import { RunsPane } from "../orchestration/RunsPane.tsx";
import { AutomationsPane } from "../automations/AutomationsPane.tsx";
import { useHubStatus } from "./hub-status.ts";

const TITLES: Partial<Record<ListPage, string>> = {
  settings: "Einstellungen",
  discovery: "Entdeckt",
  media: "Medien",
  pc: "Am PC eintippen",
  status: "Provider-Status",
  vault: "Notizen",
  orchestrierung: "Orchestrierung",
  automationen: "Automationen",
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
  vaultFile = null,
  onPopout,
  closeLabel = "Schließen",
  escCloses = true,
}: {
  page: ListPage;
  onClose: () => void;
  onOpen: (session: SessionRecord) => void;
  onSwitchToken: () => void;
  /** EPIC-P49: Datei-Deep-Link für die Vault-Seite. */
  vaultFile?: string | null;
  onPopout?: () => void;
  closeLabel?: string;
  /** Im eigenen Fenster schließt Esc nichts: das Fenster gibt man mit dem Knopf zurück. */
  escCloses?: boolean;
}) {
  const hub = useHubStatus();
  // BUG-0106: Preact 11 spült passive Effekte erst im nächsten
  // requestAnimationFrame — die Pane ist schon sichtbar, bevor dieser
  // Keydown-Listener hängt, und ein sofortiges Esc (unter CI-Last) ging
  // ins Leere. useLayoutEffect hängt den Listener synchron beim DOM-Commit.
  // Ein Dialog in der Pane (Farbwähler, T34.5) behandelt Esc selbst und
  // markiert das Event (defaultPrevented).
  useLayoutEffect(() => {
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
        {page === "vault" && <VaultPane {...(vaultFile ? { initialFile: vaultFile } : {})} />}
        {page === "orchestrierung" && <RunsPane />}
        {page === "automationen" && <AutomationsPane />}
      </div>
    </section>
  );
}
