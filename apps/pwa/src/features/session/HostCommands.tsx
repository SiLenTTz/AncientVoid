import { useState } from "preact/hooks";
import { useApi } from "../../shared/api-context.ts";

/**
 * Real user request (2026-09-19): "same session on the phone and my
 * desktop terminal" — this genuinely is the same worker process, not a
 * copy; typing in the attached tmux pane and watching it here (or vice
 * versa) both observe/drive the one real thing.
 *
 * Real, found-live caveat: for a one-shot/turn-based adapter (claude,
 * codex, opencode, copilot — a new CLI process per turn, not one
 * long-lived process for the whole session), the real tmux pane only
 * exists WHILE a turn is actively running; `TmuxRunner` cleans it up the
 * moment that turn's process exits (verified live: a session sat
 * "working" — genuinely waiting for the next prompt, not broken — with
 * no real tmux session left at all seconds after its last turn
 * finished). The command shown here is always real, correct syntax; it's
 * only actually attachable in that window. `tmux attach`'s own "session
 * not found" is an honest, self-explanatory outcome in that case — not a
 * fabricated promise, just said plainly rather than pretending it
 * always works.
 */
/** Copy button that says whether the copy really happened. */
export function CopyButton({ text }: { text: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
    } catch {
      // Clipboard needs a secure context; the text stays selectable.
      setState("failed");
    }
    setTimeout(() => setState("idle"), 1500);
  };
  return (
    <button class="btn" type="button" onClick={() => void copy()}>
      {state === "copied" ? "Kopiert" : state === "failed" ? "Bitte markieren" : "Kopieren"}
    </button>
  );
}

export function shellQuote(value: string): string {
  return /^[\w./=@%^+:-]+$/.test(value) ? value : `'${value.replaceAll("'", `'\\''`)}'`;
}

/** EPIC-P6 T6.6: a command for another host of the fleet runs there, via SSH
 * with the host id as name (the tailnet name of that machine). */
export function onHost(command: string, host: string | null): string {
  return host ? `ssh -t ${host} ${shellQuote(command)}` : command;
}

/** Changes of an isolated session are in its worktree, not the project
 * folder the editor shows — say so, and how to open it. */
export function WorktreeCard({
  sessionId,
  status,
  worktree,
  project,
  host = null,
}: {
  sessionId: string;
  status: string;
  worktree: { path: string; branch: string };
  project: string;
  host?: string | null;
}) {
  const api = useApi();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const running = status === "working" || status === "starting";
  const projectName = project.split("/").pop() ?? project;
  const apply = async () => {
    setBusy(true);
    try {
      const r = await api.applyToProject(sessionId);
      setResult(
        r.ok
          ? { ok: true, text: `Übernommen: ${r.files} Datei(en) nach ${r.into} (${r.commit}).` }
          : { ok: false, text: r.detail ?? "Übernehmen fehlgeschlagen." },
      );
    } catch (err) {
      setResult({ ok: false, text: err instanceof Error ? err.message : "Übernehmen fehlgeschlagen." });
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };
  const openInEditor = host ? `code --remote ssh-remote+${host} ${shellQuote(worktree.path)}` : `code ${shellQuote(worktree.path)}`;
  return (
    <div class="card worktree-card">
      <div class="dim" style="font-size: 12px; margin-bottom: 6px">
        Die Änderungen dieser Session liegen in einem eigenen Git-Worktree{host ? ` auf ${host}` : ""}, nicht in {project.split("/").pop()}.
        Branch <span class="mono">{worktree.branch}</span>.
      </div>
      <div class="attach-cmd-row">
        <code class="mono worktree-path">{worktree.path}</code>
        <CopyButton text={worktree.path} />
      </div>
      <div class="attach-cmd-row" style="margin-top: 6px">
        <code class="mono worktree-open">{openInEditor}</code>
        <CopyButton text={openInEditor} />
      </div>
      {confirming ? (
        <div class="apply-confirm">
          <div class="dim" style="font-size: 12px">
            Committet alle Änderungen auf {worktree.branch} und merged sie in den ausgecheckten Branch von {projectName}.
          </div>
          <div class="row" style="gap: 8px">
            <button class={busy ? "btn primary busy" : "btn primary"} type="button" disabled={busy} onClick={() => void apply()}>
              {busy ? "lädt…" : "Jetzt übernehmen"}
            </button>
            <button class="btn" type="button" disabled={busy} onClick={() => setConfirming(false)}>
              Abbrechen
            </button>
          </div>
        </div>
      ) : (
        <button
          class="btn apply-btn"
          type="button"
          disabled={running}
          title={running ? "Erst nach dem laufenden Zug" : undefined}
          onClick={() => {
            setResult(null);
            setConfirming(true);
          }}
        >
          Ins Projekt übernehmen
        </button>
      )}
      {result && <div class={result.ok ? "apply-result ok" : "apply-result reply-error"}>{result.text}</div>}
    </div>
  );
}

/**
 * T5.5: continue elsewhere — the web link to this very session (AC-P5-5)
 * and, between turns, the native terminal command for the same provider
 * session on the PC. The hub hides the command while a turn runs, so hub
 * and terminal never write at the same time.
 */
export function ContinueCard({ openCmd, host = null }: { openCmd?: string | undefined; host?: string | null }) {
  const link = typeof location === "undefined" ? "" : location.href;
  return (
    <div class="card continue-card">
      <div class="dim" style="font-size: 12px; margin-bottom: 6px">Weiterarbeiten auf einem anderen Gerät</div>
      <div class="attach-cmd-row">
        <code class="mono continue-link">{link}</code>
        <CopyButton text={link} />
      </div>
      {openCmd ? (
        <>
          <div class="dim" style="font-size: 12px; margin: 8px 0 6px">
            {host ? `Im Terminal, per SSH auf ${host}` : "Im Terminal am PC"}, dieselbe Provider-Session. Solange sie dort läuft, hier nichts senden.
          </div>
          <div class="attach-cmd-row">
            <code class="mono continue-open">{openCmd}</code>
            <CopyButton text={openCmd} />
          </div>
        </>
      ) : (
        <div class="dim continue-none" style="font-size: 11px; margin-top: 6px">
          Terminal-Befehl erscheint zwischen zwei Zügen, sobald die Provider-Session bekannt ist.
        </div>
      )}
    </div>
  );
}

export function AttachCmdRow({ cmd }: { cmd: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(cmd);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard API unavailable (e.g. insecure context) — the command
      // is still shown and selectable by hand, never a dead end.
    }
  };
  return (
    <div class="card attach-cmd-card">
      <div class="dim" style="font-size: 12px; margin-bottom: 6px">
        Am Desktop weiterarbeiten — dieselbe Session, nicht eine Kopie. Funktioniert
        sicher, während der Agent gerade aktiv einen Zug ausführt; dazwischen evtl.
        „session not found", falls gerade kein Prozess läuft:
      </div>
      <div class="attach-cmd-row">
        <code class="mono">{cmd}</code>
        <button class="btn" onClick={copy}>
          {copied ? "Kopiert" : "Kopieren"}
        </button>
      </div>
    </div>
  );
}
