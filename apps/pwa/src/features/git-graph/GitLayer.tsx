import { useEffect, useState } from "preact/hooks";
import { hubApi, remoteHost } from "../../shared/api.ts";
import { getHubStatus } from "../shell/hub-status.ts";
import { GitGraphPane } from "./GitGraphPane.tsx";
import { onLayerOpen } from "../../shared/layers.ts";
import { gitTargetQuery, loadGitState, saveGitState, type GitState, type GitTarget } from "./git-model.ts";
import { registerShortcut } from "../../shared/shortcuts/registry.ts";
import { projectName } from "../../shared/project-name.ts";
import { Button } from "../../shared/ui/index.ts";

const targetKey = (t: GitTarget): string => (t.kind === "session" ? `s:${t.id}` : `p:${t.path}`);

/**
 * Globale Git-Struktur-Ebene: derselbe Commit-Graph wie im Session-Tab „Git“, aber ohne offene
 * Session wählbar (Projekte der eigenen Maschine + fokussierte Session). Desktop rechte Spalte,
 * Touch Drawer von unten; das Ziel ist gerätelokal gepinnt (wie der Dateibaum-Root).
 */
export function GitLayer({ wide, focusedSessionId }: { wide: boolean; focusedSessionId: string | null }) {
  const [state, setState] = useState<GitState>(loadGitState);
  const [projects, setProjects] = useState<{ name: string; path: string }[]>([]);

  // Strg+Umschalt+G über die Shortcut-Registry (wie files.toggle).
  useEffect(() => {
    const off = registerShortcut("git.toggle", (e) => {
      e.preventDefault();
      setState((s) => {
        const next = { ...s, open: !s.open };
        saveGitState(next);
        return next;
      });
    });
    return off;
  }, []);

  // Geöffnet wird aus dem Dock (Rail/Knopf „Git-Struktur“ oder das globale „Mehr“).
  useEffect(
    () =>
      onLayerOpen("git", () =>
        setState((s) => {
          const next = { ...s, open: true };
          saveGitState(next);
          return next;
        }),
      ),
    [],
  );

  useEffect(() => {
    if (!state.open) return;
    let alive = true;
    hubApi.projects().then((r) => alive && setProjects(r.projects.map((p) => ({ name: p.name, path: p.path })))).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [state.open]);

  const session = focusedSessionId ? getHubStatus().sessions.find((s) => s.id === focusedSessionId) : undefined;
  const sessionName = session ? (session.title ?? projectName(session.project) ?? session.id.slice(0, 8)) : null;
  const focused: GitTarget | null = session && sessionName
    ? {
        kind: "session",
        id: session.id,
        label: `Session: ${sessionName}`,
        ...(remoteHost(session.hostId) ? { hostId: remoteHost(session.hostId) as string } : {}),
      }
    : null;
  const options: GitTarget[] = [
    ...(focused ? [focused] : []),
    ...projects.map((p): GitTarget => ({ kind: "project", path: p.path, label: `Projekt: ${p.name}` })),
  ];

  const update = (patch: Partial<GitState>) =>
    setState((s) => {
      const next = { ...s, ...patch };
      saveGitState(next);
      return next;
    });

  if (!state.open) return null;
  const target = state.target;
  return (
    <aside class={`git-layer${wide ? "" : " drawer"}`} aria-label="Git-Struktur" data-testid="git-layer">
      <header class="git-head">
        <select
          aria-label="Git-Quelle"
          value={target ? targetKey(target) : ""}
          onChange={(e) => update({ target: options.find((o) => targetKey(o) === (e.target as HTMLSelectElement).value) ?? null })}
        >
          {!target && <option value="">Quelle wählen …</option>}
          {target && !options.some((o) => targetKey(o) === targetKey(target)) && <option value={targetKey(target)}>{target.label}</option>}
          {options.map((o) => (
            <option key={targetKey(o)} value={targetKey(o)}>{o.label}</option>
          ))}
        </select>
        <Button aria-label="Git-Struktur schließen" onClick={() => update({ open: false })}>✕</Button>
      </header>
      {target ? (
        <div class="git-body">
          <GitGraphPane target={gitTargetQuery(target)} hostId={target.hostId ?? null} sessionId={target.kind === "session" ? target.id : null} />
        </div>
      ) : (
        <div class="git-picker" data-testid="git-picker">
          {options.length === 0 && <div class="ui-empty">Kein Projekt gefunden und keine Session fokussiert — eine Quelle erscheint, sobald eine Session läuft.</div>}
          {options.map((o) => (
            <button
              key={targetKey(o)}
              type="button"
              class="git-picker-tile"
              title={o.kind === "project" ? o.path : o.id}
              onClick={() => update({ target: o })}
            >
              {o.kind === "project" ? projectName(o.path) : sessionName}
            </button>
          ))}
        </div>
      )}
    </aside>
  );
}
