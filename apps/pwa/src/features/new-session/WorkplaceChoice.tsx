import { useEffect, useState } from "preact/hooks";
import type { WorkspacePreview } from "../../shared/api.ts";

export type WorkplaceMode = "worktree" | "direct";

interface Api {
  workspacePreview: (project: string) => Promise<WorkspacePreview>;
}

/**
 * EPIC-P38 T38.4 (ADR-0057): Arbeitsort beim Start — zwei beschriftete Karten,
 * Standard „Eigener Worktree“. Die Harness-Sandbox/der Modus ist davon
 * getrennt (eigenes Feld darunter) und wird hier ausdrücklich nicht versprochen.
 */
export function WorkplaceChoice({
  api,
  project,
  mode,
  onMode,
  confirmDirty,
  onConfirmDirty,
  confirmShared,
  onConfirmShared,
  onBlockedChange,
}: {
  api: Api;
  project: string;
  mode: WorkplaceMode;
  onMode: (mode: WorkplaceMode) => void;
  confirmDirty: boolean;
  onConfirmDirty: (value: boolean) => void;
  /** ADR-0077: ausdrücklich bestätigtes parallels Schreiben in einem Nicht-Git-Ordner. */
  confirmShared: boolean;
  onConfirmShared: (value: boolean) => void;
  /** Start ist blockiert (Checkout belegt, Dirty unbestätigt, Vorschau fehlt) — Grund steht in der Karte. */
  onBlockedChange: (blocked: boolean) => void;
}) {
  const [preview, setPreview] = useState<WorkspacePreview | null>(null);
  const [failure, setFailure] = useState("");

  useEffect(() => {
    setPreview(null);
    setFailure("");
    if (!project) return;
    let alive = true;
    api
      .workspacePreview(project)
      .then((p) => {
        if (!alive) return;
        setPreview(p);
        // Kein Git: der ehrliche Weg ist „Projekt direkt“ — vorbelegen statt scheitern lassen.
        if (!p.worktreePossible) onMode("direct");
      })
      .catch((err) => alive && setFailure(err instanceof Error ? err.message : "Vorschau nicht verfügbar"));
    return () => {
      alive = false;
    };
  }, [project, api]);

  const direct = mode === "direct";
  const dirty = preview?.dirty ?? [];
  // ADR-0077: „belegt“ heißt nicht mehr nur Allein-Schreiber — in Ordnern ohne Git
  // sind Mit-Nutzer erlaubt, aber nur nach Bestätigung. Git bleibt gesperrt.
  const isGitCheckout = preview ? preview.isGit : true;
  const holders = direct ? preview?.holders ?? (preview?.heldBy ? [preview.heldBy] : []) : [];
  const held = direct && preview?.heldBy ? preview.heldBy : null;
  const sharedAllowed = holders.length > 0 && !isGitCheckout && confirmShared;
  const dirtyBlock = direct && dirty.length > 0 && !confirmDirty;
  const blocked = direct && ((holders.length > 0 && !sharedAllowed) || dirtyBlock);
  useEffect(() => onBlockedChange(blocked), [blocked]);

  return (
    <fieldset class="workplace-choice">
      <legend>Arbeitsort</legend>
      <div class="workplace-cards" role="radiogroup" aria-label="Arbeitsort">
        <label class={mode === "worktree" ? "workplace-card active" : "workplace-card"}>
          <input
            type="radio"
            name="workplace"
            value="worktree"
            aria-label="Arbeitsort Worktree"
            checked={mode === "worktree"}
            disabled={preview !== null && !preview.worktreePossible}
            onChange={() => onMode("worktree")}
          />
          <strong>Eigener Worktree</strong>
          <span class="dim">Änderungen landen in einer eigenen Git-Kopie, dein Projekt bleibt unberührt. Standard.</span>
          {preview !== null && !preview.worktreePossible && <span class="dim">Nicht möglich: kein Git-Projekt.</span>}
        </label>
        <label class={mode === "direct" ? "workplace-card active" : "workplace-card"}>
          <input type="radio" name="workplace" value="direct" aria-label="Arbeitsort direkt im Ordner" checked={mode === "direct"} onChange={() => onMode("direct")} />
          <strong>Projekt direkt</strong>
          <span class="dim">Der Agent arbeitet im Projektordner selbst. In Git-Projekten schreibt höchstens eine Session; Ordner ohne Git können mehrere Sessions teilen — nach ausdrücklicher Bestätigung.</span>
        </label>
      </div>
      <p class="dim workplace-note">
        Ein Worktree trennt nur Git-Dateien — keine Prozess- oder Netzwerkrechte. Was der Agent darf, regelt der Modus („Modus“ / Sandbox des Harness) unabhängig davon.
      </p>
      {failure && <div class="workplace-warn" role="status">{failure}</div>}
      {direct && preview && (
        <div class="workplace-detail" data-testid="workplace-detail">
          <div class="mono">{preview.checkoutId}</div>
          {preview.branch && <div class="dim">Branch {preview.branch}</div>}
          <div class="dim">Änderungen anderer Programme (Editor, Terminal) kann AncientVoid nicht sperren, nur erkennen.</div>
          {held && isGitCheckout && <div class="workplace-warn" role="alert">Hier schreibt bereits eine andere AncientVoid-Session ({held.slice(0, 8)}). Erst beenden oder „Eigener Worktree“ wählen.</div>}
          {holders.length > 0 && !isGitCheckout && (
            <div class="workplace-warn" role="alert">
              <div>
                In diesem Ordner {holders.length === 1
                  ? `schreibt bereits eine andere AncientVoid-Session (${holders.map((h) => h.slice(0, 8)).join(", ")})`
                  : `schreiben bereits ${holders.length} andere AncientVoid-Sessions (${holders.map((h) => h.slice(0, 8)).join(", ")})`}
                . Ohne Git gibt es keine Trennung — beide können sich gegenseitig überschreiben.
              </div>
              <label class="workplace-confirm">
                <input type="checkbox" checked={confirmShared} onChange={(e) => onConfirmShared((e.target as HTMLInputElement).checked)} />
                Mehrere Sessions in diesem Ordner — ich nehme das Überschreibrisiko in Kauf.
              </label>
            </div>
          )}
          {dirty.length > 0 && (
            <div class="workplace-warn" role="alert">
              <div>Ungesicherte Änderungen im Projekt ({dirty.length}{preview.dirtyTruncated ? "+" : ""}):</div>
              <ul class="mono">
                {dirty.slice(0, 8).map((d) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
              <label class="workplace-confirm">
                <input type="checkbox" checked={confirmDirty} onChange={(e) => onConfirmDirty((e.target as HTMLInputElement).checked)} />
                Trotzdem starten — diese Änderungen bleiben unangetastet und gelten nicht als Leistung der Session.
              </label>
            </div>
          )}
        </div>
      )}
    </fieldset>
  );
}
