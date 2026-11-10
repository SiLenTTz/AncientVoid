import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { TreeEntry, TreeListing } from "@ancientvoid/contracts";
import { hostApi, remoteHost } from "../../shared/api.ts";
import { FileViewer } from "./FileViewer.tsx";
import { openPopout } from "../windows/windows.ts";
import { rootKey, rootTarget, saveFilesState, type FilesRoot, type FilesState } from "./files-model.ts";

export interface FocusedSession {
  id: string;
  label: string;
  hostId?: string | null;
}

const GIT_MARK: Record<NonNullable<TreeEntry["git"]>, string> = { modified: "M", added: "A", deleted: "D", untracked: "U", ignored: "I", conflict: "!" };

/** Kinder eines geöffneten Ordners, seitenweise nachgeladen — nie rekursiv (ADR-0058 §2). */
function Folder({ hostId, target, path, depth, showIgnored, onOpenFile, activePath }: { hostId: string | null; target: string; path: string; depth: number; showIgnored: boolean; onOpenFile: (path: string) => void; activePath: string | null }) {
  const [pages, setPages] = useState<TreeListing[]>([]);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const api = hostApi(hostId);
  const load = (offset: number, fresh: boolean) =>
    api
      .codeTree(target, path, offset, showIgnored)
      .then((l) => {
        setError("");
        setPages((prev) => (fresh ? [l] : [...prev, l]));
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Ordner nicht lesbar"));
  useEffect(() => {
    setPages([]);
    void load(0, true);
  }, [target, path, showIgnored]);
  // Agentenänderungen: gezielte Revalidierung des geöffneten Ordners (ADR-0058 §2), ohne Watch-Abhängigkeit.
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible" && pages.length <= 1) void load(0, true);
    }, 5000);
    return () => clearInterval(timer);
  }, [target, path, showIgnored, pages.length]);
  const last = pages[pages.length - 1];
  const entries = pages.flatMap((p) => p.entries);
  return (
    <ul class="files-tree" role={depth === 0 ? "tree" : "group"}>
      {error && <li class="files-error" role="alert">{error}</li>}
      {entries.map((e) => {
        const isDir = e.kind === "dir" && e.blocked === null;
        const expanded = open.has(e.path);
        return (
          <li key={e.path} role="treeitem" aria-expanded={isDir ? expanded : undefined}>
            <button
              type="button"
              class={`files-row${activePath === e.path ? " active" : ""}${e.blocked ? " blocked" : ""}`}
              style={{ paddingLeft: `${depth * 12 + 6}px` }}
              disabled={e.blocked !== null}
              title={e.blocked ?? e.path}
              data-path={e.path}
              onClick={() => {
                if (isDir) {
                  const next = new Set(open);
                  if (expanded) next.delete(e.path);
                  else next.add(e.path);
                  setOpen(next);
                } else if (e.kind === "file") onOpenFile(e.path);
              }}
            >
              <span class="files-glyph" aria-hidden="true">{isDir ? (expanded ? "▾" : "▸") : e.blocked ? "⛔" : e.symlink ? "↪" : "·"}</span>
              <span class="files-name">{e.name}</span>
              {e.blocked && <span class="dim files-why">{e.blocked}</span>}
              {e.git && <span class={`files-git git-${e.git}`} title={e.git}>{GIT_MARK[e.git]}</span>}
            </button>
            {isDir && expanded && <Folder hostId={hostId} target={target} path={e.path} depth={depth + 1} showIgnored={showIgnored} onOpenFile={onOpenFile} activePath={activePath} />}
          </li>
        );
      })}
      {last?.nextOffset != null && (
        <li>
          <button type="button" class="btn files-more" style={{ marginLeft: `${depth * 12 + 6}px` }} onClick={() => void load(last.nextOffset!, false)}>
            Weitere {last.total - entries.length} Einträge laden
          </button>
        </li>
      )}
      {pages.length > 0 && entries.length === 0 && !error && <li class="dim files-empty" style={{ paddingLeft: `${depth * 12 + 6}px` }}>leer</li>}
      {depth === 0 && last && !last.filters.ignored && last.filters.ignoredHidden > 0 && (
        <li class="dim files-empty">{last.filters.ignoredHidden} ignorierte Einträge ausgeblendet</li>
      )}
    </ul>
  );
}

/**
 * EPIC-P46 T46.4 (ADR-0058): rechte Projekt-Sidebar (Desktop) bzw. Drawer (Touch). Root, Branch und Checkout
 * stehen sichtbar oben; die Root ist gepinnt und wechselt nie heimlich mit der Kachel.
 */
export function FilesSidebar({
  state,
  onChange,
  focused,
  projects,
  mobile,
}: {
  state: FilesState;
  onChange: (next: FilesState) => void;
  focused: FocusedSession | null;
  projects: { name: string; path: string; hostId?: string; hostLabel?: string }[];
  mobile: boolean;
}) {
  const [identity, setIdentity] = useState<TreeListing["identity"] | null>(null);
  const root = state.root;
  const rKey = root ? rootKey(root) : "";
  const tabs = state.tabs.filter((t) => t.rootKey === rKey);
  const activeTab = state.active >= 0 ? state.tabs[state.active] : undefined;
  const viewing = activeTab && activeTab.rootKey === rKey ? activeTab : undefined;
  const [view, setView] = useState<"tree" | "file">("tree");
  const widthRef = useRef(state.width);
  widthRef.current = state.width;

  const roots = useMemo(() => {
    const list: FilesRoot[] = [];
    if (focused) list.push({ kind: "session", id: focused.id, label: `Session: ${focused.label}${remoteHost(focused.hostId) ? " (andere Maschine)" : ""}`, ...(remoteHost(focused.hostId) ? { hostId: remoteHost(focused.hostId) } : {}) });
    for (const p of projects) list.push({ kind: "project", path: p.path, label: `Projekt: ${p.name}${p.hostLabel ? ` (${p.hostLabel})` : ""}`, ...(p.hostId ? { hostId: p.hostId } : {}) });
    return list;
  }, [focused?.id, focused?.hostId, projects]);

  const update = (patch: Partial<FilesState>) => {
    const next = { ...state, ...patch };
    saveFilesState(next);
    onChange(next);
  };

  useEffect(() => {
    if (!root) return setIdentity(null);
    let alive = true;
    hostApi(root.hostId).codeTree(rootTarget(root), "", 0, false).then((l) => alive && setIdentity(l.identity)).catch(() => alive && setIdentity(null));
    return () => {
      alive = false;
    };
  }, [rKey]);

  const openFile = (path: string) => {
    const existing = state.tabs.findIndex((t) => t.rootKey === rKey && t.path === path);
    if (existing >= 0) update({ active: existing });
    else update({ tabs: [...state.tabs, { rootKey: rKey, path }], active: state.tabs.length });
    setView("file");
  };
  const closeTab = (index: number) => {
    const tabsNext = state.tabs.filter((_, i) => i !== index);
    update({ tabs: tabsNext, active: Math.min(state.active >= index ? state.active - 1 : state.active, tabsNext.length - 1) });
  };

  const startResize = (ev: PointerEvent) => {
    ev.preventDefault();
    const startX = ev.clientX;
    const startW = widthRef.current;
    const move = (e: PointerEvent) => update({ width: Math.min(Math.max(startW + (startX - e.clientX), 280), 1100) });
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  if (!state.open) return null;
  const showFile = view === "file" && viewing;
  return (
    <aside class={`files-sidebar${mobile ? " drawer" : ""}`} style={mobile ? undefined : { width: `${state.width}px` }} aria-label="Dateibaum" data-testid="files-sidebar">
      {!mobile && <div class="files-resize" role="separator" aria-orientation="vertical" aria-label="Breite ändern" onPointerDown={startResize as never} />}
      <header class="files-head">
        <select
          aria-label="Dateiquelle"
          value={rKey}
          onChange={(e) => {
            const next = roots.find((r) => rootKey(r) === (e.target as HTMLSelectElement).value) ?? null;
            update({ root: next });
            setView("tree");
          }}
        >
          {!root && <option value="">Quelle wählen …</option>}
          {root && !roots.some((r) => rootKey(r) === rKey) && <option value={rKey}>{root.label}</option>}
          {roots.map((r) => (
            <option key={rootKey(r)} value={rootKey(r)}>{r.label}</option>
          ))}
        </select>
        <button type="button" class="btn" aria-label="Dateien schließen" onClick={() => update({ open: false })}>✕</button>
      </header>
      {identity && (
        <div class="files-identity dim" title={identity.root} data-testid="files-identity">
          {identity.kind === "session" ? "Worktree der Session" : "Projektordner"} · {identity.root.split("/").slice(-2).join("/")}
          {identity.branch ? ` · ${identity.branch}` : ""}
        </div>
      )}
      {!root && <div class="empty">Wähle eine Session oder ein Projekt.</div>}
      {root && (
        <>
          <div class="files-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={!showFile} class={!showFile ? "chip active" : "chip"} onClick={() => setView("tree")}>Baum</button>
            {tabs.map((t) => {
              const index = state.tabs.indexOf(t);
              return (
                <span key={t.path} class="files-tab">
                  <button type="button" role="tab" aria-selected={Boolean(showFile) && state.active === index} class={showFile && state.active === index ? "chip active" : "chip"} title={t.path} onClick={() => { update({ active: index }); setView("file"); }}>
                    {t.path.split("/").pop()}
                  </button>
                  {root.kind === "session" && (
                    <button
                      type="button"
                      class="files-tab-popout"
                      aria-label={`${t.path} in eigenes Fenster`}
                      title="In eigenes Fenster"
                      onClick={() => void openPopout({ kind: "file", sessionId: root.id, path: t.path, ...(root.hostId ? { hostId: root.hostId } : {}) })}
                    >
                      ⧉
                    </button>
                  )}
                  <button type="button" class="files-tab-close" aria-label={`${t.path} schließen`} onClick={() => closeTab(index)}>×</button>
                </span>
              );
            })}
            {!showFile && (
              <label class="dim files-ignored">
                <input type="checkbox" checked={state.showIgnored} onChange={(e) => update({ showIgnored: (e.target as HTMLInputElement).checked })} /> Ignoriertes
              </label>
            )}
          </div>
          <div class="files-body">
            {showFile && viewing ? (
              <FileViewer key={`${viewing.rootKey}:${viewing.path}`} hostId={root.hostId ?? null} sessionId={root.kind === "session" ? root.id : null} target={rootTarget(root)} path={viewing.path} />
            ) : (
              <Folder key={`${rKey}:${state.showIgnored}`} hostId={root.hostId ?? null} target={rootTarget(root)} path="" depth={0} showIgnored={state.showIgnored} onOpenFile={openFile} activePath={viewing?.path ?? null} />
            )}
          </div>
        </>
      )}
    </aside>
  );
}
