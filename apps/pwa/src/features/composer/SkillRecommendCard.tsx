import { useEffect, useState } from "preact/hooks";
import { useApi } from "../../shared/api-context.ts";
import type { PromptRecommendation, SkillArtifact } from "../../shared/api.ts";
import { Button } from "../../shared/ui/index.ts";
import { ARTIFACT_NAME, engineLabel, newArtifactDraft, renameDraft, skippedNote } from "./engine-label.ts";

/**
 * EPIC-P68 T68.6 (ADR-0089 §3): the recommendation shows what already
 * exists before anything new is written. `match`/`update` load the current
 * file; *Anpassen* edits it in place (saved against its hash), *Anpassung
 * vorschlagen* lets the model draft the edit, nothing is written without
 * *Datei speichern*. `create` opens the draft editable before it is created.
 */
export function SkillRecommendCard({
  recommendation,
  project,
  adapter,
  prompt,
  busy,
  noteFor,
  error,
  onDismiss,
  onUse,
}: {
  recommendation: PromptRecommendation;
  project: string;
  adapter: string;
  /** The (enhanced) prompt — the request a revision should serve. */
  prompt: string;
  busy: boolean;
  noteFor: (item: PromptRecommendation) => string;
  error: string;
  onDismiss: () => void;
  /** `next` overrides the recommendation (a new file, an edited draft). */
  onUse: (persist: boolean, next: PromptRecommendation) => void;
}) {
  const api = useApi();
  const [current, setCurrent] = useState<PromptRecommendation>(recommendation);
  const [artifact, setArtifact] = useState<SkillArtifact | null>(null);
  const [loadError, setLoadError] = useState("");
  const [editing, setEditing] = useState(recommendation.mode === "create");
  const [draft, setDraft] = useState(recommendation.draft ?? "");
  const [revising, setRevising] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [cardError, setCardError] = useState("");

  const existing = current.mode !== "create";
  const load = async () => {
    setLoadError("");
    try {
      const next = await api.skillArtifact(project, current.kind, current.name);
      setArtifact(next);
      return next;
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Datei nicht lesbar");
      return null;
    }
  };
  useEffect(() => {
    if (existing) void load();
  }, [current.kind, current.name, current.mode]);

  const readOnly = artifact?.layer === "base" || current.layer === "base";
  const kindLabel = current.kind === "agent" ? "Agent" : current.kind === "workflow" ? "Workflow" : "Skill";
  const heading =
    current.mode === "match" ? `Empfehlung · ${kindLabel}` : current.mode === "update" ? `Vorhanden · ${kindLabel} anpassen` : `Vorschlag · ${kindLabel} anlegen`;

  const startEdit = () => {
    if (!artifact) return;
    setDraft(artifact.content);
    setStatus("");
    setCardError("");
    setEditing(true);
  };

  const revise = async () => {
    setCardError("");
    setRevising(true);
    try {
      const result = await api.reviseArtifact({ project, kind: current.kind, name: current.name, prompt, adapter });
      setDraft(result.draft);
      const skipped = skippedNote(result.skipped);
      setStatus(`Vorschlag ${engineLabel(result.engine)}${skipped ? ` — ${skipped}` : ""}`);
      if (artifact && result.baseHash !== artifact.hash) await load();
    } catch (err) {
      setCardError(err instanceof Error ? err.message : "Vorschlag fehlgeschlagen");
    } finally {
      setRevising(false);
    }
  };

  const save = async () => {
    if (!artifact) return;
    setCardError("");
    setSaving(true);
    try {
      const saved = await api.updateArtifact({ project, kind: current.kind, name: current.name, draft, baseHash: artifact.hash });
      setArtifact({ ...artifact, content: draft.endsWith("\n") ? draft : `${draft}\n`, hash: saved.hash });
      setStatus(`Gespeichert: ${saved.path}`);
      setEditing(false);
    } catch (err) {
      const conflict = (err as { status?: number }).status === 409;
      setCardError(conflict ? "Die Datei wurde inzwischen geändert. Aktueller Stand ist geladen — Änderung erneut prüfen." : err instanceof Error ? err.message : "Speichern fehlgeschlagen");
      if (conflict) await load();
    } finally {
      setSaving(false);
    }
  };

  /** Premortem 5: the near-duplicate guess may be wrong — a new file stays possible. */
  const createInstead = () => {
    // A taken name answers 409 on create; the field stays editable.
    const name = `${current.name}-2`;
    const next: PromptRecommendation = { mode: "create", kind: current.kind, name, description: current.description, reason: "Neu statt Anpassen.", draft: null };
    setCurrent(next);
    setArtifact(null);
    setDraft(newArtifactDraft(current.kind, name, current.description, prompt));
    setStatus("");
    setEditing(true);
  };

  const nameValid = ARTIFACT_NAME.test(current.name);
  const use = (persist: boolean) => onUse(persist, current.mode === "create" ? { ...current, draft } : current);
  const anyBusy = busy || saving || revising;

  return (
    <div class="recommend-card">
      <div class="recommend-meta">{heading}</div>
      {current.mode === "create" ? (
        <label class="recommend-name">
          <span class="recommend-meta">Name</span>
          <input
            class="recommend-name-input"
            value={current.name}
            aria-invalid={nameValid ? undefined : true}
            onInput={(e) => {
              const name = (e.currentTarget as HTMLInputElement).value.trim();
              setCurrent({ ...current, name });
              setDraft((d) => renameDraft(d, name));
            }}
          />
        </label>
      ) : (
        <strong>{current.name}</strong>
      )}
      <div class="recommend-desc">{current.description}</div>
      <div class="recommend-meta">{current.reason}</div>
      <div class="recommend-meta">{noteFor(current)}</div>
      {readOnly && <div class="recommend-meta">Basis-Skill — hier nur lesbar. Eine Anpassung gehört als Projekt-Erweiterung ins Projekt.</div>}

      {existing && !editing && artifact && (
        <details class="recommend-current" open={current.mode === "update"}>
          <summary>Aktueller Inhalt · {artifact.path}</summary>
          <pre class="recommend-content">{artifact.content}</pre>
        </details>
      )}
      {loadError && <div class="composer-notice err">{loadError}</div>}

      {editing && (
        <textarea
          class="recommend-editor"
          aria-label={current.mode === "create" ? "Entwurf" : "Datei bearbeiten"}
          value={draft}
          onInput={(e) => setDraft((e.currentTarget as HTMLTextAreaElement).value)}
          rows={10}
        />
      )}
      {status && <div class="recommend-meta">{status}</div>}
      {(cardError || error) && <div class="composer-notice err">{cardError || error}</div>}

      {editing && existing ? (
        <div class="row">
          <Button disabled={anyBusy} onClick={() => setEditing(false)}>
            Abbrechen
          </Button>
          <Button aria-busy={revising} disabled={anyBusy} onClick={() => void revise()} class={revising ? "busy" : undefined}>
            {revising ? "lädt…" : "Anpassung vorschlagen"}
          </Button>
          <Button aria-busy={saving} disabled={anyBusy || !draft.trim()} onClick={() => void save()} variant="primary" class={saving ? "busy" : undefined}>
            {saving ? "lädt…" : "Datei speichern"}
          </Button>
        </div>
      ) : (
        <>
          {existing && !readOnly && (
            <div class="row">
              <Button disabled={anyBusy || !artifact} onClick={startEdit}>
                Anpassen
              </Button>
              {current.mode === "update" && (
                <Button disabled={anyBusy} onClick={createInstead}>
                  Trotzdem neu anlegen
                </Button>
              )}
            </div>
          )}
          <div class="row">
            <Button disabled={anyBusy} onClick={onDismiss}>
              Verwerfen
            </Button>
            <Button aria-busy={busy} disabled={anyBusy || (current.mode === "create" && (!nameValid || !draft.trim()))} onClick={() => use(false)} class={busy ? "busy" : undefined}>
              {busy ? "lädt…" : "Nutzen"}
            </Button>
            <Button
              aria-busy={busy}
              disabled={anyBusy || (current.mode === "create" && (!nameValid || !draft.trim()))}
              onClick={() => use(true)}
              variant="primary"
              class={busy ? "busy" : undefined}
            >
              {busy ? "lädt…" : "Als Standard"}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
