// EPIC-P43 T43.3: das Dock hat vier Ziele und eine Haupttaste — Start, Suchen, ＋, Teams, Mehr.
// Alles Übrige (Medien, Notizen, Automationen, Einstellungen, Provider-Status) liegt einen
// Tipp weiter im Blatt „Mehr“; am PC (Leiste links, 21-icon-rail.css) stehen diese Ziele weiterhin
// einzeln in der Leiste, dort gibt es kein „Mehr“. „approvals“ wird aus der Übersicht erreicht,
// „Entdeckt“ ist seit EPIC-P47 ein Umschalt-State der Übersicht (kein eigener Menüpunkt mehr).
// `active` hebt nie etwas hervor, solange eine Seite offen ist, die kein Dock-Ziel ist.
import { useEffect, useRef, useState } from "preact/hooks";
import { TabIcon, type TabIconName } from "../shared/TabIcon.tsx";
import { openCommandBar } from "../features/commands/CommandBar.tsx";
import { openLayer } from "../shared/layers.ts";
import { ariaCombo, comboLabel, registerShortcut } from "../shared/shortcuts/registry.ts";
export type { ListPage as Page } from "./route.ts";
import type { ListPage as Page } from "./route.ts";

const MORE: readonly { page: Page; icon: TabIconName; label: string; title: string }[] = [
  { page: "media", icon: "medien", label: "Medien", title: "Medien: Videos analysieren" },
  { page: "vault", icon: "notizen", label: "Notizen", title: "Notizen (Knowledge Vault)" },
  { page: "automationen", icon: "automationen", label: "Automationen", title: "Automationen (Zeitpläne)" },
  { page: "settings", icon: "einstellungen", label: "Einstellungen", title: "Einstellungen" },
];

/**
 * Die eine globale Navigation. Am Handy und Tablet eine Reihe unten, am PC die Leiste links.
 */
export function GlobalDock({ active, onNavigate }: { active: Page | null; onNavigate: (page: Page) => void }) {
  const [more, setMore] = useState(false);
  useEffect(() => {
    if (!more) return;
    // EPIC-P51 T51.5: Esc über die Shortcut-Registry.
    return registerShortcut("dock.more-close", (e) => {
      e.preventDefault();
      setMore(false);
    });
  }, [more]);
  const go = (page: Page) => {
    setMore(false);
    onNavigate(page);
  };
  const inMore = MORE.some((m) => m.page === active) || active === "status";
  // EPIC-P51 T51.6: Roving-Navigation — Pfeiltasten bewegen den Fokus durchs
  // Dock (PC: Leiste links ↑/↓, Handy: Leiste unten ←/→; beide Achsen wirken).
  const dockRef = useRef<HTMLElement>(null);
  const onDockKey = (e: KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const items = [...(dockRef.current?.querySelectorAll<HTMLButtonElement>("button.dock-item:not([disabled])") ?? [])];
    const idx = items.indexOf(document.activeElement as HTMLButtonElement);
    if (idx === -1) return;
    const forward = e.key === "ArrowDown" || e.key === "ArrowRight";
    const next = items[(idx + (forward ? 1 : items.length - 1)) % items.length];
    e.preventDefault();
    next.focus();
  };
  return (
    <nav class="dock" aria-label="Navigation" ref={dockRef} onKeyDown={onDockKey}>
      <button class={`dock-item ${active === "dashboard" ? "active" : ""}`} type="button" title="Start" onClick={() => go("dashboard")}>
        <TabIcon name="uebersicht" /><span class="lb">Start</span>
      </button>
      <button class="dock-item" type="button" title={`Suchen und Auftrag in Worten (${comboLabel("command.toggle")})`} aria-keyshortcuts={ariaCombo("command.toggle")} data-shortcut="command.toggle" onClick={() => { setMore(false); openCommandBar(); }}>
        <TabIcon name="suche" /><span class="lb">Suchen</span>
      </button>
      <button class={`dock-item dock-main ${active === "new" ? "active" : ""}`} type="button" title="Neue Session" aria-label="Neue Session" onClick={() => go("new")}>
        <TabIcon name="neu" />
      </button>
      <button class={`dock-item ${active === "teams" ? "active" : ""}`} type="button" title="Teams (Agenten-Teams)" onClick={() => go("teams")}>
        <TabIcon name="teams" /><span class="lb">Teams</span>
      </button>
      <button class={`dock-item dock-more ${inMore ? "active" : ""}`} type="button" title="Mehr" aria-haspopup="dialog" aria-expanded={more} onClick={() => setMore((on) => !on)}>
        <TabIcon name="mehr" /><span class="lb">Mehr</span>
      </button>
      {MORE.map((m) => (
        <button key={m.page} class={`dock-item dock-extra ${active === m.page ? "active" : ""}`} type="button" title={m.title} onClick={() => go(m.page)}>
          <TabIcon name={m.icon} /><span class="lb">{m.label}</span>
        </button>
      ))}
      <button class="dock-item dock-extra" type="button" title={`Dateibaum (${comboLabel("files.toggle")})`} aria-keyshortcuts={ariaCombo("files.toggle")} data-shortcut="files.toggle" onClick={() => openLayer("files")}>
        <TabIcon name="baum" /><span class="lb">Dateibaum</span>
      </button>
      {more && (
        <div class="overlay-backdrop more-backdrop" onClick={() => setMore(false)}>
          <div class="overlay-sheet more-sheet" role="dialog" aria-label="Mehr" onClick={(e) => e.stopPropagation()}>
            {MORE.map((m) => (
              <button key={m.page} class={`more-item ${active === m.page ? "active" : ""}`} type="button" onClick={() => go(m.page)}>
                <TabIcon name={m.icon} />
                <span>{m.label}</span>
              </button>
            ))}
            <button class={`more-item ${active === "status" ? "active" : ""}`} type="button" onClick={() => go("status")}>
              <TabIcon name="bericht" />
              <span>Provider-Status</span>
            </button>
            {/* Ohne offene Session: Dateibaum über alle Projekte (früher die Randlasche „Dateien“). */}
            <button class="more-item" type="button" onClick={() => { setMore(false); openLayer("files"); }}>
              <TabIcon name="baum" />
              <span>Dateibaum</span>
            </button>
          </div>
        </div>
      )}
    </nav>
  );
}
