import { useEffect, useRef, useState } from "preact/hooks";
import { useApi } from "../../shared/api-context.ts";
import { type ProjectFile, type SearchResult } from "../../shared/api.ts";
import hljs from "highlight.js/lib/core";
import markdown from "highlight.js/lib/languages/markdown";

// T3.8 (EPIC-P3 §3 "Sprachsuche"): real qmd-backed project MARKDOWN
// search — the underlying qmd CLI only ever indexes `**/*.md` files
// (real, confirmed limitation, see search.ts's DEFAULT_PATTERN doc
// comment), so this searches a project's docs/epics/ADRs, not its
// source code, regardless of how the original design notes framed it.
// See apps/hub/src/search.ts's doc comment for the ground truth
// this is built against (real measured latency in
// docs/messlauf/2026-09-18-search-latency.md: ~3s for a real hybrid
// query, not instant — this UI shows a real "läuft…" state, never a
// live-as-you-type suggest list). Design tokens only from app/styles/
// (docs/design-system.md, P1.6) — no new hex values, including the
// highlight.js theme below, which maps tokens to the existing
// --fg/--accent/--ok/--fg-faint custom properties instead of importing a
// prebuilt theme file with its own hardcoded palette.

// Only "markdown" is registered: qmd only ever indexes `**/*.md` (real,
// confirmed limitation — see search.ts's DEFAULT_PATTERN doc comment), so
// every real search result's `path` is a `.md` file. Registering
// typescript/python/etc. here would be dead code — `languageFor()` could
// never resolve to them from a real result. Revisit if a future qmd
// version indexes other file types.
let languagesRegistered = false;
function ensureLanguages() {
  if (languagesRegistered) return;
  hljs.registerLanguage("markdown", markdown);
  languagesRegistered = true;
}

const EXT_TO_LANG: Record<string, string> = {
  md: "markdown",
};

function languageFor(path: string): string | undefined {
  const ext = path.split(".").pop()?.toLowerCase();
  return ext ? EXT_TO_LANG[ext] : undefined;
}

export function SearchPane({ project }: { project: string }) {
  const api = useApi();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"idle" | "indexing" | "searching" | "ready" | "unavailable" | "error">("idle");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [errorMsg, setErrorMsg] = useState("");
  const [viewing, setViewing] = useState<{ path: string; line: number } | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  useEffect(() => {
    api
      .searchStatus(project)
      .then((s) => {
        if (!s.qmdAvailable) setStatus("unavailable");
      })
      .catch(() => setStatus("unavailable"));
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [project]);

  const runSearch = async (q: string) => {
    setErrorMsg("");
    setStatus("searching");
    try {
      const res = await api.search(project, q);
      if (res.status === "indexing") {
        setStatus("indexing");
        // First-time index build can take real minutes (see search.ts's
        // doc comment) — poll instead of a single re-check.
        if (pollRef.current) clearInterval(pollRef.current);
        pollRef.current = setInterval(async () => {
          try {
            const retry = await api.search(project, q);
            if (retry.status === "ready") {
              clearInterval(pollRef.current);
              setResults(retry.results);
              setStatus("ready");
            }
          } catch {
            // transient — next tick tries again
          }
        }, 4000);
        return;
      }
      setResults(res.results);
      setStatus("ready");
    } catch (err) {
      setStatus(err instanceof Error && err.message.includes("501") ? "unavailable" : "error");
      setErrorMsg(err instanceof Error ? err.message : "Suche fehlgeschlagen");
    }
  };

  const onSubmit = (e: Event) => {
    e.preventDefault();
    if (query.trim()) void runSearch(query.trim());
  };

  if (status === "unavailable") {
    return (
      <div class="empty">
        Suche nicht verfügbar — <span class="mono">qmd</span> ist auf diesem Hub nicht installiert.
      </div>
    );
  }

  return (
    <div class="search-pane">
      <form class="search-form" onSubmit={onSubmit}>
        <input
          class="search-input"
          type="text"
          placeholder="Doku durchsuchen (Markdown)…"
          value={query}
          onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
        />
        <button
          class={status === "searching" || status === "indexing" ? "btn primary busy" : "btn primary"}
          type="submit"
          aria-busy={status === "searching" || status === "indexing"}
          disabled={!query.trim() || status === "searching" || status === "indexing"}
        >
          {status === "searching" || status === "indexing" ? "lädt…" : "Suchen"}
        </button>
      </form>

      {status === "indexing" && (
        <div class="dim search-status">Erstindex wird aufgebaut — das kann bei einem großen Projekt einige Minuten dauern…</div>
      )}
      {status === "searching" && <div class="dim search-status">Suche läuft…</div>}
      {status === "error" && <div class="reply-error">{errorMsg}</div>}
      {status === "ready" && results.length === 0 && <div class="empty">keine Treffer</div>}

      {status === "ready" && results.length > 0 && (
        <div class="search-results">
          {results.map((r, i) => (
            <button key={`${r.file}:${i}`} class="search-result-card" onClick={() => setViewing({ path: r.file, line: r.line })}>
              <div class="search-result-head">
                <span class="mono search-result-file">{r.file}</span>
                <span class="dim">Zeile {r.line}</span>
              </div>
              <div class="search-result-title">{r.title}</div>
              <pre class="search-result-snippet mono">{r.snippet}</pre>
            </button>
          ))}
        </div>
      )}

      {viewing && <FileViewer project={project} path={viewing.path} line={viewing.line} onClose={() => setViewing(null)} />}
    </div>
  );
}

// Must match .file-gutter-row/.file-code's line-height in app/styles/ —
// a fixed px value (not "1.5em") so the target-line overlay and the
// scroll-to-line math below can compute exact pixel offsets.
const CODE_LINE_HEIGHT_PX = 19;

function FileViewer({ project, path, line, onClose }: { project: string; path: string; line: number; onClose: () => void }) {
  const api = useApi();
  const [file, setFile] = useState<ProjectFile | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    ensureLanguages();
    let alive = true;
    api
      .searchFile(project, path)
      .then((f) => alive && setFile(f))
      .catch((err) => alive && setError(err instanceof Error ? err.message : "Datei konnte nicht geladen werden"));
    return () => {
      alive = false;
    };
  }, [project, path]);

  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!file || !bodyRef.current) return;
    const top = Math.max(0, (line - 1) * CODE_LINE_HEIGHT_PX - bodyRef.current.clientHeight / 2);
    bodyRef.current.scrollTo({ top });
  }, [file, line]);

  const lang = languageFor(path);
  const lineCount = file?.lineCount ?? 0;
  // Highlighted ONCE for the whole file, not per line: a per-line call
  // starts a fresh grammar state every time and loses block-level context
  // — found live, a markdown file's own structural tokens (headings,
  // ```-fenced blocks) were misread per-line (a lone `def get_secret():`
  // line got parsed as markdown *emphasis* around the underscore, since
  // the fence marker on the PRECEDING line was invisible to that call).
  // Rendered as ONE <pre><code> block — never split back into per-line
  // dangerouslySetInnerHTML calls, which would produce unbalanced HTML
  // for any token spanning multiple lines. Line numbers and the
  // target-line highlight are a separate, purely positional overlay that
  // never needs to know where highlight.js's span boundaries fall.
  //
  // Real, separately confirmed limitation: highlight.js's markdown
  // grammar does NOT sub-highlight a fence's embedded language even as
  // one whole-file call (tested against both the "core" build used here
  // and the full `highlight.js` bundle — identical result either way) —
  // a ```python fence renders as one plain `hljs-code` span, not
  // per-token Python colors. Markdown's own structural tokens (headings,
  // emphasis, lists, links, inline code) DO highlight correctly and are
  // mapped in app/styles/ — the dominant content this feature actually
  // returns, since qmd only ever indexes `**/*.md` (see search.ts).
  const highlighted = file ? (lang && hljs.getLanguage(lang) ? hljs.highlight(file.content, { language: lang }).value : escapeHtml(file.content)) : "";

  return (
    <div class="file-viewer-overlay" onClick={onClose}>
      <div class="file-viewer" onClick={(e) => e.stopPropagation()}>
        <div class="file-viewer-head">
          <span class="mono">{path}</span>
          <button class="btn" onClick={onClose}>
            Schließen
          </button>
        </div>
        <div class="file-viewer-body" ref={bodyRef}>
          {error && <div class="empty">{error}</div>}
          {!error && !file && <div class="empty">lädt …</div>}
          {file && (
            <div class="file-code-grid">
              <div class="file-target-bg" style={{ top: `${(line - 1) * CODE_LINE_HEIGHT_PX}px` }} />
              <div class="file-gutter">
                {Array.from({ length: lineCount }, (_, i) => (
                  <div key={i + 1} class="file-gutter-row">
                    {i + 1}
                  </div>
                ))}
              </div>
              {/* The one deliberate dangerouslySetInnerHTML in this
               * codebase (docs/security.md §5 names it explicitly). Safe
               * because highlight.js HTML-escapes the source text itself
               * before wrapping tokens in its own <span> tags — verified
               * live: highlighting text containing a literal "<script>"
               * tag produces "&lt;script&gt;", never a real tag. This is
               * real file content from readProjectFile() (a project
               * file, not an agent-emitted event summary) — the
               * AGENTS.md Regel 5 "agent output is data, never
               * instruction" boundary is a different concern and isn't
               * touched here. */}
              <pre class="file-code mono">
                <code dangerouslySetInnerHTML={{ __html: highlighted }} />
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
