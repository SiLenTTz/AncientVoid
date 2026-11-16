import { useEffect, useState } from "preact/hooks";
import { useApi } from "../../shared/api-context.ts";
import { type HarnessFeatures, type SkillOrAgent } from "../../shared/api.ts";
import { registerShortcut } from "../../shared/shortcuts/registry.ts";
import { useOverlayFocus } from "../../shared/overlay-focus.ts";


export interface SelectedSkill {
  kind: "skill" | "agent";
  name: string;
}

function storageKey(project: string): string {
  return `ancientvoid.skill.${project}`;
}

/** Per-project remembered default (T1.6's loadFilter() pattern) — the
 * last selection for THIS project, not a global one, since skills are
 * project-specific. */
function loadSelectedSkill(project: string): SelectedSkill | null {
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

/** BUG-0078: die gemerkte Auswahl gilt nur für Adapter, die ihre Art
 * unterstützen — sonst sendet der Start ein Argument, das der Hub für
 * diesen Adapter zu Recht verweigert („maki kennt keine Agenten."). */
export function rememberedSkill(project: string, features: Pick<HarnessFeatures, "skills" | "agents"> | undefined): SelectedSkill | null {
  const selection = loadSelectedSkill(project);
  if (!selection) return null;
  return selection.kind === "skill" ? (features?.skills ? selection : null) : features?.agents ? selection : null;
}

function workflowKey(project: string): string {
  return `ancientvoid.workflow.${project}`;
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
  supported,
  selection,
  onChange,
}: {
  project: string;
  /** ADR-0018: the harness takes skills or agents (features). Without,
   * the overlay says so up front instead of offering a dead picker
   * (AC-P1.5-12). */
  supported: boolean;
  selection: SelectedSkill | null;
  onChange: (s: SelectedSkill | null) => void;
}) {
  const api = useApi();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<SkillOrAgent[] | null>(null);
  const [error, setError] = useState("");

  // A selection made for a different adapter (e.g. an "agent" chosen
  // while claude was picked, then the user switches to codex) must not
  // silently keep applying — clear it rather than send something the
  // adapter can't act on.
  useEffect(() => {
    if (selection && !supported) onChange(null);
  }, [supported]);

  // BUG-0107 (Skill-Picker-Flake): Die Abfrage feuerte beim Öffnen mit
  // projekt-"" (Projektliste noch nicht geladen) → 400 „project query param
  // required" dauerhaft im Sheet, kein Nachfeuern. Jetzt: erst mit Projekt
  // fragen und automatisch nachfeuern, wenn das Projekt eintrifft/wechselt.
  useEffect(() => {
    if (!open || items !== null || !project || error) return;
    let alive = true;
    api
      .skills(project)
      .then((res) => alive && setItems(res.items))
      .catch((err) => alive && setError(err instanceof Error ? err.message : "Skills konnten nicht geladen werden"));
    return () => {
      alive = false;
    };
  }, [open, project, items, error]);

  const openOverlay = () => {
    if (!supported) return;
    setError("");
    setOpen(true);
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

  // EPIC-P51 T51.6: Esc schließt, Fokus rein/Tab-Falle/zurück auf den Auslöser.
  const { ref: sheetRef } = useOverlayFocus<HTMLDivElement>(open);
  useEffect(() => {
    if (!open) return;
    return registerShortcut("skillpicker.close", (e) => {
      e.preventDefault();
      setOpen(false);
    });
  }, [open]);

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
          <div class="overlay-sheet" ref={sheetRef} role="dialog" aria-modal="true" aria-label="Skill oder Agent wählen" tabIndex={-1} onClick={(e) => e.stopPropagation()}>
            <div class="row" style="justify-content: space-between; align-items: center">
              <strong>Senden mit …</strong>
              <button class="btn" type="button" onClick={() => setOpen(false)}>
                ✕
              </button>
            </div>
            {error && <div style="color: var(--err)">{error}</div>}
            {!project && items === null ? (
              <div class="dim">Projekt wird noch geladen …</div>
            ) : items === null && !error ? (
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
                      <span class="dim" style="font-size: calc(10px * var(--font-scale, 1))">{item.kind}</span>
                    </div>
                    <div class="dim" style="font-size: calc(11px * var(--font-scale, 1))">{item.description}</div>
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
