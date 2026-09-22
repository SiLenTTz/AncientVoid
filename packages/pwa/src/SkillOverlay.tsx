import { useEffect, useState } from "preact/hooks";
import { hubApi, type SkillOrAgent } from "./api.ts";

/** T1.5-10/ADR-0005: only claude has a verified skill/agent invocation
 * mechanism (`/name` prefix, `--agent` flag). codex fails loud instead of
 * silently ignoring a selection (adapter-codex/src/index.ts), but the
 * overlay itself is honest up front and doesn't even offer the picker
 * for an adapter with no real mechanism (AC-P1.5-12). */
const SKILL_INVOCATION_SUPPORTED_ADAPTERS = new Set(["claude"]);

export interface SelectedSkill {
  kind: "skill" | "agent";
  name: string;
}

function storageKey(project: string): string {
  return `uacc.skill.${project}`;
}

/** Per-project remembered default (T1.6's loadFilter() pattern) — the
 * last selection for THIS project, not a global one, since skills are
 * project-specific. */
export function loadSelectedSkill(project: string): SelectedSkill | null {
  try {
    const raw = localStorage.getItem(storageKey(project));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SelectedSkill;
    if (parsed.kind === "skill" || parsed.kind === "agent") return parsed;
    return null;
  } catch {
    return null;
  }
}

export function saveSelectedSkill(project: string, selection: SelectedSkill | null): void {
  if (selection) localStorage.setItem(storageKey(project), JSON.stringify(selection));
  else localStorage.removeItem(storageKey(project));
}

function workflowKey(project: string): string {
  return `uacc.workflow.${project}`;
}

export function loadSelectedWorkflow(project: string): string | null {
  return localStorage.getItem(workflowKey(project));
}

export function saveSelectedWorkflow(project: string, name: string | null): void {
  if (name) localStorage.setItem(workflowKey(project), name);
  else localStorage.removeItem(workflowKey(project));
}

/**
 * The "Senden mit …" launcher: a chip showing the current selection
 * (always visible, per the user's own requirement — "so dass man nicht
 * immer auswählen muss aber kann") that opens an overlay listing the
 * target project's real skills/agents on tap. Selecting one closes the
 * overlay and persists it as this project's new default.
 */
export function SkillPicker({
  project,
  adapter,
  selection,
  onChange,
}: {
  project: string;
  adapter: string;
  selection: SelectedSkill | null;
  onChange: (s: SelectedSkill | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<SkillOrAgent[] | null>(null);
  const [error, setError] = useState("");
  const supported = SKILL_INVOCATION_SUPPORTED_ADAPTERS.has(adapter);

  // A selection made for a different adapter (e.g. an "agent" chosen
  // while claude was picked, then the user switches to codex) must not
  // silently keep applying — clear it rather than send something the
  // adapter can't act on.
  useEffect(() => {
    if (selection && !supported) onChange(null);
  }, [supported]);

  const openOverlay = () => {
    if (!supported) return;
    setError("");
    setOpen(true);
    if (items === null) {
      hubApi
        .skills(project)
        .then((res) => setItems(res.items))
        .catch((err) => setError(err instanceof Error ? err.message : "Skills konnten nicht geladen werden"));
    }
  };

  const pick = (item: SkillOrAgent) => {
    if (item.kind !== "skill" && item.kind !== "agent") return; // "workflow" never populated, see api.ts
    const next: SelectedSkill = { kind: item.kind, name: item.name };
    onChange(next);
    saveSelectedSkill(project, next);
    setOpen(false);
  };

  const clear = () => {
    onChange(null);
    saveSelectedSkill(project, null);
    setOpen(false);
  };

  if (!supported) {
    return (
      <div class="skill-chip dim" title="Für diesen Adapter nicht verfügbar">
        Skills/Agents: für diesen Adapter nicht verfügbar
      </div>
    );
  }

  return (
    <div>
      <button type="button" class="skill-chip btn" onClick={openOverlay}>
        {selection ? `${selection.kind === "agent" ? "Agent" : "Skill"}: ${selection.name}` : "+ Skill/Agent"}
      </button>

      {open && (
        <div class="overlay-backdrop" onClick={() => setOpen(false)}>
          <div class="overlay-sheet" onClick={(e) => e.stopPropagation()}>
            <div class="row" style="justify-content: space-between; align-items: center">
              <strong>Senden mit …</strong>
              <button class="btn" type="button" onClick={() => setOpen(false)}>
                ✕
              </button>
            </div>
            {error && <div style="color: var(--err)">{error}</div>}
            {items === null && !error ? (
              <div class="dim">lade…</div>
            ) : items && items.length === 0 ? (
              <div class="dim">Keine Skills/Agents in diesem Projekt gefunden.</div>
            ) : (
              <div class="skill-list">
                {items
                  ?.filter((item) => item.kind === "skill" || item.kind === "agent")
                  .map((item) => (
                  <button
                    key={`${item.kind}:${item.name}`}
                    type="button"
                    class={`skill-item ${selection?.kind === item.kind && selection.name === item.name ? "active" : ""}`}
                    onClick={() => pick(item)}
                  >
                    <div class="row" style="justify-content: space-between">
                      <strong>{item.name}</strong>
                      <span class="dim" style="font-size: 10px">{item.kind}</span>
                    </div>
                    <div class="dim" style="font-size: 11px">{item.description}</div>
                  </button>
                ))}
              </div>
            )}
            <button type="button" class="btn" onClick={clear}>
              Ohne Skill/Agent senden
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
