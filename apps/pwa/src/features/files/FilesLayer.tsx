import { useEffect, useState } from "preact/hooks";
import { hostApi, hubApi, remoteHost } from "../../shared/api.ts";
import { getHubStatus, useHubStatus } from "../shell/hub-status.ts";
import { FilesSidebar, type FocusedSession } from "./FilesSidebar.tsx";
import { onLayerOpen } from "../../shared/layers.ts";
import { loadFilesState, rootKey, saveFilesState, type FilesState } from "./files-model.ts";
import { registerShortcut } from "../../shared/shortcuts/registry.ts";

/**
 * EPIC-P46 T46.4: Einstieg der rechten Sidebar. Desktop: dritte Spalte (Strg+Umschalt+E), Touch: Drawer;
 * geöffnet über den Reiter „Dateien“ bzw. das globale „Mehr“ (EPIC-P43). Der Zustand (Breite, Root, Tabs) ist gerätelokal; die Root folgt der fokussierten Kachel
 * nur, wenn noch keine gewählt ist — danach bleibt sie sichtbar gepinnt.
 * BUG-0128: `windowed` — die Seitenleiste füllt als Dateibaum-Fenster die ganze Fläche; ✕ schließt das Fenster,
 * der Tastatur-Toggle bleibt dem Hauptfenster vorbehalten.
 */
export function FilesLayer({ wide, focusedSessionId, windowed = false }: { wide: boolean; focusedSessionId: string | null; windowed?: boolean }) {
  const [state, setState] = useState<FilesState>(() => (windowed ? { ...loadFilesState(), open: true } : loadFilesState()));
  const hubStatus = useHubStatus();
  const reachableHosts = hubStatus.hosts.filter((h) => remoteHost(h.hostId) && h.state === "reachable").map((h) => `${h.hostId}:${h.label ?? ""}`).join(",");
  const [projects, setProjects] = useState<{ name: string; path: string; hostId?: string; hostLabel?: string }[]>([]);

  // EPIC-P51 T51.5: Strg+Umschalt+E über die Shortcut-Registry statt eigenem Listener.
  useEffect(() => {
    if (windowed) return;
    const off = registerShortcut("files.toggle", (e) => {
      e.preventDefault();
      setState((s) => {
        const next = { ...s, open: !s.open };
        saveFilesState(next);
        return next;
      });
    });
    return off;
  }, [windowed]);

  // EPIC-P43: geöffnet wird aus dem Reiter „Dateien“ oder dem globalen „Mehr“ (keine Randlasche mehr).
  useEffect(
    () =>
      onLayerOpen("files", () =>
        setState((s) => {
          const next = { ...s, open: true };
          saveFilesState(next);
          return next;
        }),
      ),
    [],
  );

  // EPIC-P47 T47.2: Karte der Projekt-Ansicht pins diesen Root und öffnet die Sidebar.
  useEffect(() => {
    const on = (e: Event) => {
      const detail = (e as CustomEvent<{ kind: string; path: string; label: string }>).detail;
      if (!detail || detail.kind !== "project") return;
      setState((s) => {
        const next = { ...s, open: true, root: { kind: "project" as const, path: detail.path, label: detail.label } };
        saveFilesState(next);
        return next;
      });
    };
    window.addEventListener("ancientvoid:files-open-root", on);
    return () => window.removeEventListener("ancientvoid:files-open-root", on);
  }, []);

  // ADR-0071: Git-Graph Datei-Klick → Session-Root + Datei im Explorer.
  useEffect(() => {
    const on = (e: Event) => {
      const detail = (e as CustomEvent<{ sessionId: string; path: string; hostId?: string | null }>).detail;
      if (!detail?.sessionId || !detail.path) return;
      const session = getHubStatus().sessions.find((s) => s.id === detail.sessionId);
      const label = session?.title ?? session?.project.split("/").pop() ?? detail.sessionId.slice(0, 8);
      const host = detail.hostId ?? remoteHost(session?.hostId) ?? null;
      setState((s) => {
        const root = {
          kind: "session" as const,
          id: detail.sessionId,
          label: `Session: ${label}${host ? " (andere Maschine)" : ""}`,
          ...(host ? { hostId: host } : {}),
        };
        const key = rootKey(root);
        const existing = s.tabs.findIndex((t) => t.rootKey === key && t.path === detail.path);
        const tabs = existing >= 0 ? s.tabs : [...s.tabs, { rootKey: key, path: detail.path }];
        const active = existing >= 0 ? existing : tabs.length - 1;
        const next = { ...s, open: true, root, tabs, active };
        saveFilesState(next);
        return next;
      });
    };
    window.addEventListener("ancientvoid:files-open-path", on);
    return () => window.removeEventListener("ancientvoid:files-open-path", on);
  }, []);

  useEffect(() => {
    if (!state.open) return;
    let alive = true;
    hubApi.projects().then((r) => alive && setProjects((prev) => [...r.projects.map((p) => ({ name: p.name, path: p.path })), ...prev.filter((p) => p.hostId)])).catch(() => undefined);
    // Andere Maschinen der Flotte: Projekte über deren eigene Hub-API, nur erreichbare Hosts.
    for (const h of getHubStatus().hosts) {
      const id = remoteHost(h.hostId);
      if (!id || h.state !== "reachable") continue;
      hostApi(id).projects().then((r) => {
        if (!alive) return;
        const label = h.label ?? id.slice(0, 8);
        setProjects((prev) => [...prev.filter((p) => p.hostId !== id), ...r.projects.map((p) => ({ name: p.name, path: p.path, hostId: id, hostLabel: label }))]);
      }).catch(() => undefined);
    }
    return () => { alive = false; };
  }, [state.open, reachableHosts]);

  const session = focusedSessionId ? getHubStatus().sessions.find((s) => s.id === focusedSessionId) : undefined;
  const focused: FocusedSession | null = session
    ? { id: session.id, label: session.title ?? session.project.split("/").pop() ?? session.id.slice(0, 8), hostId: session.hostId ?? null }
    : null;

  // Erste Nutzung: die fokussierte Session als Quelle vorschlagen — danach nie heimlich wechseln.
  useEffect(() => {
    if (state.open && !state.root && focused && !focused.hostId?.startsWith("remote")) {
      setState((s) => {
        const next: FilesState = { ...s, root: { kind: "session", id: focused.id, label: `Session: ${focused.label}` } };
        saveFilesState(next);
        return next;
      });
    }
  }, [state.open, state.root, focused?.id]);

  return (
    <>
      <FilesSidebar state={state} onChange={setState} focused={focused} projects={projects} mobile={!wide} windowed={windowed} />
    </>
  );
}
