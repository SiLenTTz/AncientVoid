import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { useApi } from "../../shared/api-context.ts";
import type { ActionDefinition, ActionRun, CodeFile, CodeSearchResult, WorkspaceIdentity } from "../../shared/api.ts";
import { codeHash, sessionHash, type CodeTarget } from "../../app/route.ts";
import { registerField, touchField } from "../../shared/command-context.ts";

/** Lines shown at once — a 1 MB file stays usable on a phone. */
const WINDOW = 1500;

function short(sha: string | null): string {
  return sha ? sha.slice(0, 8) : "—";
}

function IdentityLine({ identity }: { identity: WorkspaceIdentity }) {
  return (
    <div class="code-identity dim" title={identity.root}>
      {identity.kind === "session" ? "Worktree der Session" : "Projektordner"}
      {identity.branch ? ` · ${identity.branch}` : ""} · {short(identity.head)}
      {identity.base ? ` · Basis ${short(identity.base)}` : ""}
    </div>
  );
}

/**
 * T7.6: code in the session's worktree — local search (text or symbol),
 * a viewer with line anchors (`…/code/<path>:L<n>`), and the registered
 * actions (tests, git, tools) with their status and output.
 */
export function CodePane({ sessionId, hostId, initial, onOpenDiff }: { sessionId: string; hostId: string | null; initial?: CodeTarget; onOpenDiff: () => void }) {
  const api = useApi();
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<"text" | "symbol">("symbol");
  const [result, setResult] = useState<CodeSearchResult | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState<CodeFile | null>(null);
  const [line, setLine] = useState<number | null>(initial?.line ?? null);

  // T9.4: a field the text entry can fill; a search asked for in words runs here.
  const queryRef = useRef(query);
  queryRef.current = query;
  useEffect(() => registerField("code_query", { get: () => queryRef.current, set: setQuery }), []);
  useEffect(() => {
    const pending = JSON.parse(sessionStorage.getItem("ancientvoid.pendingCodeSearch") ?? "null") as { sessionId?: string; text?: string } | null;
    if (pending?.sessionId !== sessionId || !pending.text) return;
    sessionStorage.removeItem("ancientvoid.pendingCodeSearch");
    setQuery(pending.text);
    setMode("symbol");
    void api.codeSearch(sessionId, pending.text, "symbol").then(setResult).catch((err) => setError(err instanceof Error ? err.message : "Suche fehlgeschlagen"));
  }, [sessionId]);

  const openFile = async (path: string, at: number | null) => {
    setError("");
    try {
      const f = await api.codeFile(sessionId, path);
      setFile(f);
      setLine(at);
      history.replaceState(null, "", codeHash(sessionId, path, at, hostId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Datei nicht lesbar");
    }
  };

  useEffect(() => {
    if (initial) void openFile(initial.path, initial.line);
  }, [initial?.path, initial?.line]);

  const search = async () => {
    if (!query.trim()) return;
    setBusy(true);
    setError("");
    try {
      setResult(await api.codeSearch(sessionId, query.trim(), mode));
      setFile(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Suche fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  };

  if (file) {
    return (
      <FileView
        file={file}
        line={line}
        onLine={(n) => {
          setLine(n);
          history.replaceState(null, "", codeHash(sessionId, file.path, n, hostId));
        }}
        onBack={() => {
          setFile(null);
          history.replaceState(null, "", sessionHash(sessionId, hostId));
        }}
        onOpenDiff={onOpenDiff}
      />
    );
  }

  return (
    <div class="code-pane">
      <form
        class="code-search"
        onSubmit={(e) => {
          e.preventDefault();
          void search();
        }}
      >
        <input
          type="search"
          value={query}
          placeholder={mode === "symbol" ? "Funktion, Klasse …" : "Text im Code…"}
          aria-label="Code durchsuchen"
          onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
          onFocus={() => touchField("code_query")}
        />
        <button class="btn primary" type="submit" disabled={busy || !query.trim()}>
          {busy ? "sucht…" : "Suchen"}
        </button>
      </form>
      <div class="filter-bar">
        <button type="button" class={`chip ${mode === "symbol" ? "active" : ""}`} onClick={() => setMode("symbol")}>
          Symbol
        </button>
        <button type="button" class={`chip ${mode === "text" ? "active" : ""}`} onClick={() => setMode("text")}>
          Text
        </button>
      </div>
      {error && <div class="reply-error">{error}</div>}
      {result && (
        <div class="code-results">
          <IdentityLine identity={result.identity} />
          {result.matches.length === 0 ? (
            <div class="empty">Keine Treffer.</div>
          ) : (
            result.matches.map((m) => (
              <button key={`${m.path}:${m.line}:${m.column}`} type="button" class={`code-hit ${m.kind}`} onClick={() => void openFile(m.path, m.line)}>
                <span class="code-hit-where">
                  {m.path}:{m.line}
                  {m.kind === "definition" && <span class="code-hit-def">Definition</span>}
                </span>
                <code>{m.text.trim()}</code>
              </button>
            ))
          )}
          {result.truncated && <div class="dim">Mehr als {result.matches.length} Treffer — genauer suchen.</div>}
          <div class="dim code-engine">lokal · {result.engine}</div>
        </div>
      )}
      <ActionsPanel sessionId={sessionId} />
    </div>
  );
}

function FileView({ file, line, onLine, onBack, onOpenDiff }: { file: CodeFile; line: number | null; onLine: (n: number) => void; onBack: () => void; onOpenDiff: () => void }) {
  const lines = useMemo(() => file.content.split("\n"), [file.content]);
  const total = file.content.endsWith("\n") ? lines.length - 1 : lines.length;
  const [start, setStart] = useState(() => Math.max(1, (line ?? 1) - Math.floor(WINDOW / 2)));
  const end = Math.min(total, start + WINDOW - 1);
  const anchor = useRef<HTMLLIElement>(null);

  useEffect(() => {
    if (line && (line < start || line > end)) setStart(Math.max(1, line - Math.floor(WINDOW / 2)));
    anchor.current?.scrollIntoView({ block: "center" });
  }, [line, file.path]);

  return (
    <div class="code-file">
      <div class="code-file-head">
        <button type="button" class="btn" onClick={onBack}>
          ← Suche
        </button>
        <div class="code-file-title">
          <strong>{file.path}</strong>
          <span class="dim">
            {file.language} · {total} Zeilen{file.blobSha ? ` · ${file.blobSha.slice(0, 8)}` : ""}
          </span>
        </div>
      </div>
      <IdentityLine identity={file.identity} />
      {file.changed && (
        <button type="button" class="code-changed" onClick={onOpenDiff}>
          In dieser Session geändert: +{file.changed.additions} −{file.changed.deletions} → Diff
        </button>
      )}
      {file.binary ? (
        <div class="empty">Binärdatei — wird nicht angezeigt.</div>
      ) : (
        <>
          {start > 1 && (
            <button type="button" class="btn code-more" onClick={() => setStart(Math.max(1, start - WINDOW))}>
              Zeilen davor
            </button>
          )}
          <ol class="code-lines" start={start}>
            {lines.slice(start - 1, end).map((text, i) => {
              const n = start + i;
              return (
                <li key={n} id={`L${n}`} ref={n === line ? anchor : undefined} class={n === line ? "hit" : ""}>
                  <button type="button" class="ln" aria-label={`Zeile ${n}`} onClick={() => onLine(n)}>
                    {n}
                  </button>
                  <code>{text || " "}</code>
                </li>
              );
            })}
          </ol>
          {end < total && (
            <button type="button" class="btn code-more" onClick={() => setStart(start + WINDOW)}>
              Zeilen danach
            </button>
          )}
          {file.truncated && <div class="dim">Datei größer als 1 MB — nur der Anfang ist geladen.</div>}
        </>
      )}
    </div>
  );
}

const STATUS_TEXT: Record<ActionRun["status"], string> = {
  running: "läuft",
  succeeded: "erfolgreich",
  failed: "fehlgeschlagen",
  timeout: "abgebrochen (Zeit)",
  stopped: "gestoppt",
};

const KIND_TEXT: Record<ActionDefinition["kind"], string> = { test: "Test", git: "Git", tool: "Werkzeug" };

/** Befehle des Repos nach Quelle gruppiert (package.json, Makefile, scripts/, Git …), je mit „Ausführen“. */
function ActionsPanel({ sessionId }: { sessionId: string }) {
  const api = useApi();
  const [actions, setActions] = useState<ActionDefinition[] | null>(null);
  const [runs, setRuns] = useState<ActionRun[]>([]);
  const [params, setParams] = useState<Record<string, Record<string, string>>>({});
  const [error, setError] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  const load = async () => {
    try {
      const r = await api.sessionActions(sessionId);
      setActions(r.actions);
      setRuns(r.runs);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Befehle nicht ladbar");
    }
  };
  useEffect(() => {
    void load();
  }, [sessionId]);

  const running = runs.some((r) => r.status === "running");
  const runningRun = (actionId: string) => runs.find((r) => r.actionId === actionId && r.status === "running");
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => void load(), 1000);
    return () => clearInterval(t);
  }, [running]);

  const run = async (a: ActionDefinition) => {
    setError("");
    try {
      const started = await api.runAction(sessionId, a.id, params[a.id] ?? {});
      setRuns((prev) => [started, ...prev]);
      setOpen(a.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Befehl nicht gestartet");
    }
  };

  const stop = async (r: ActionRun) => {
    setError("");
    try {
      await api.stopAction(sessionId, r.id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Befehl nicht gestoppt");
    }
  };

  const groups = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const by = new Map<string, ActionDefinition[]>();
    for (const a of actions ?? []) {
      if (needle && !`${a.label} ${a.argv.join(" ")}`.toLowerCase().includes(needle)) continue;
      const key = a.source ?? KIND_TEXT[a.kind];
      by.set(key, [...(by.get(key) ?? []), a]);
    }
    return [...by.entries()];
  }, [actions, filter]);

  if (!actions) return error ? <div class="reply-error">{error}</div> : null;
  return (
    <div class="code-actions">
      <h3>Befehle</h3>
      <input type="search" class="action-filter" placeholder="Befehle filtern …" aria-label="Befehle filtern" value={filter} onInput={(e) => setFilter((e.target as HTMLInputElement).value)} />
      {error && <div class="reply-error">{error}</div>}
      {groups.length === 0 && <div class="empty">Keine passenden Befehle.</div>}
      {groups.map(([source, list]) => (
        <section key={source} class="action-group" aria-label={source}>
          <h4 class="action-source dim">{source}</h4>
          {list.map((a) => {
            const last = runs.find((r) => r.actionId === a.id);
            return (
              <div key={a.id} class="action-row">
                <div class="action-main">
                  <span class={`action-kind ${a.kind}`}>{KIND_TEXT[a.kind]}</span>
                  <span class="action-label" title={a.argv.join(" ")}>
                    {a.label}
                  </span>
                  {last && (
                    <button type="button" class={`action-status-btn ${last.status}`} onClick={() => setOpen(open === a.id ? null : a.id)} aria-expanded={open === a.id}>
                      {STATUS_TEXT[last.status]}{last.exitCode !== null && last.status !== "succeeded" ? ` · Code ${last.exitCode}` : ""}
                    </button>
                  )}
                  {runningRun(a.id) ? (
                    <button type="button" class="btn danger" aria-label={`${a.label} stoppen`} onClick={() => void stop(runningRun(a.id)!)}>
                      Stoppen
                    </button>
                  ) : (
                    <button type="button" class="btn" disabled={runs.filter((r) => r.status === "running").length >= 4} aria-label={`${a.label} ausführen`} title={a.longRunning ? "Startet ohne Zeitlimit bis „Stoppen“; Fenster öffnen sich auf dem Rechner des Hubs" : undefined} onClick={() => void run(a)}>
                      Ausführen
                    </button>
                  )}
                </div>
                {Object.entries(a.params).map(([name, p]) => (
                  <input
                    key={name}
                    
                    placeholder={`${name}${p.optional ? " (optional)" : ""}${p.description ? ` — ${p.description}` : ""}`}
                    aria-label={`${a.label}: ${name}`}
                    value={params[a.id]?.[name] ?? ""}
                    onInput={(e) => setParams((prev) => ({ ...prev, [a.id]: { ...prev[a.id], [name]: (e.target as HTMLInputElement).value } }))}
                  />
                ))}
                {last && open === a.id && (
                  <pre class="action-output">
                    {last.outputTruncated ? "…" : ""}
                    {last.output || (last.status === "running" ? "…" : "(keine Ausgabe)")}
                  </pre>
                )}
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
}
