import { useEffect, useState } from "preact/hooks";
import { hubApi } from "../../shared/api.ts";
import { getHubStatus } from "../shell/hub-status.ts";
import { FilesSidebar, type FocusedSession } from "./FilesSidebar.tsx";
import { loadFilesState, saveFilesState, type FilesState } from "./files-model.ts";

/**
 * EPIC-P46 T46.4: Einstieg der rechten Sidebar. Desktop: dritte Spalte (Strg+Umschalt+E), Touch: Drawer über
 * einen Tab am Rand. Der Zustand (Breite, Root, Tabs) ist gerätelokal; die Root folgt der fokussierten Kachel
 * nur, wenn noch keine gewählt ist — danach bleibt sie sichtbar gepinnt.
 */
export function FilesLayer({ wide, focusedSessionId }: { wide: boolean; focusedSessionId: string | null }) {
  const [state, setState] = useState<FilesState>(loadFilesState);
  const [projects, setProjects] = useState<{ name: string; path: string }[]>([]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "e") {
        e.preventDefault();
        setState((s) => {
          const next = { ...s, open: !s.open };
          saveFilesState(next);
          return next;
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!state.open) return;
    hubApi.projects().then((r) => setProjects(r.projects.map((p) => ({ name: p.name, path: p.path })))).catch(() => setProjects([]));
  }, [state.open]);

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
      {!state.open && (
        <button
          type="button"
          class="files-toggle"
          aria-label="Dateibaum öffnen"
          title="Dateibaum (Strg+Umschalt+E)"
          onClick={() => {
            const next = { ...state, open: true };
            saveFilesState(next);
            setState(next);
          }}
        >
          Dateien
        </button>
      )}
      <FilesSidebar state={state} onChange={setState} focused={focused} projects={projects} mobile={!wide} />
    </>
  );
}
