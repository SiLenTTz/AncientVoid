import { useEffect, useRef, useState } from "preact/hooks";
import { useApi } from "../../shared/api-context.ts";
import { type ProjectDoc, type ProjectFile, type SearchResult } from "../../shared/api.ts";
import { Markdown } from "../../shared/Markdown.tsx";

// T3.8 (EPIC-P3 §3 "Sprachsuche"): real qmd-backed project MARKDOWN search
// (the underlying qmd CLI only ever indexes `**/*.md` files — see
// search.ts's DEFAULT_PATTERN doc comment), plus the structured document
// overview over the same files (no qmd needed — plain directory listing).
// Documents open rendered as Markdown (shared/Markdown.tsx, Preact nodes,
// never innerHTML) — a documentation viewer, not a code viewer: no gutter,
// no line numbers, no highlight.js. Design tokens only from app/styles/
// (docs/design-system.md, P1.6).

/** Verzeichnis-Gruppe der Dokumentübersicht; „." ist das Projekt-Stammverzeichnis. */
export interface DocGroup {
  dir: string;
  items: ProjectDoc[];
}

export function groupDocs(docs: readonly ProjectDoc[]): DocGroup[] {
  const groups = new Map<string, ProjectDoc[]>();
  for (const doc of docs) {
    const dir = doc.path.includes("/") ? doc.path.slice(0, doc.path.lastIndexOf("/")) : ".";
    (groups.get(dir) ?? groups.set(dir, []).get(dir)!).push(doc);
  }
  return [...groups.entries()]
    .sort((a, b) => (a[0] === "." ? -1 : b[0] === "." ? 1 : a[0].localeCompare(b[0])))
    .map(([dir, items]) => ({ dir, items }));
}

export function dirLabel(dir: string): string {
  return dir === "." ? "Stammverzeichnis" : dir;
}

/** Der stabilste gemeinsame Kern eines Snippets: führender Titel/Whitespace
 * * ist weg, gekürzt — genug, um den Abschnitt im gerenderten Dokument
 * wiederzufinden, ohne von Markdown-Formatierung abzuhängen. */
export function snippetAnchor(snippet: string): string {
  return snippet.replace(/\s+/g, " ").trim().slice(0, 60);
}

function docName(doc: ProjectDoc): string {
  return doc.path.slice(doc.path.lastIndexOf("/") + 1);
}

export function SearchPane({ project }: { project: string }) {
  const api = useApi();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"idle" | "indexing" | "searching" | "ready" | "unavailable" | "error">("idle");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [errorMsg, setErrorMsg] = useState("");
  const [viewing, setViewing] = useState<{ path: string; snippet?: string } | null>(null);
  const [docs, setDocs] = useState<ProjectDoc[] | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    api
      .searchStatus(project)
      .then((s) => {
        if (alive && !s.qmdAvailable) setStatus("unavailable");
      })
      .catch(() => alive && setStatus("unavailable"));
    // Die Dokumentübersicht braucht kein qmd — sie steht auch ohne Index.
    api
      .searchDocs(project)
      .then((res) => alive && setDocs(res.docs))
      .catch(() => alive && setDocs([]));
    return () => {
      alive = false;
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

  const searching = status === "searching" || status === "indexing";

  return (
    <div class="search-pane">
      {status === "unavailable" ? (
        <div class="dim search-status">
          Volltextsuche nicht verfügbar — <span class="mono">qmd</span> ist auf diesem Hub nicht installiert. Die Dokumente unten lassen sich trotzdem öffnen.
        </div>
      ) : (
        <form class="search-form" onSubmit={onSubmit}>
          <input
            class="search-input"
            type="text"
            placeholder="Doku durchsuchen (Markdown)…"
            value={query}
            onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
          />
          <button class={searching ? "btn primary busy" : "btn primary"} type="submit" aria-busy={searching} disabled={!query.trim() || searching}>
            {searching ? "lädt…" : "Suchen"}
          </button>
        </form>
      )}

      {status === "indexing" && (
        <div class="dim search-status">Erstindex wird aufgebaut — das kann bei einem großen Projekt einige Minuten dauern…</div>
      )}
      {status === "searching" && <div class="dim search-status">Suche läuft…</div>}
      {status === "error" && <div class="reply-error">{errorMsg}</div>}
      {status === "ready" && results.length === 0 && <div class="empty">keine Treffer</div>}

      {status === "ready" && results.length > 0 && (
        <div class="search-results">
          {results.map((r, i) => (
            <button
              key={`${r.file}:${i}`}
              class="search-result-card"
              onClick={() => setViewing({ path: r.file, snippet: r.snippet })}
            >
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

      <div class="doc-overview">
        <div class="doc-overview-head dim">Dokumente · {docs === null ? "lädt…" : `${docs.length}`}</div>
        {docs !== null && docs.length === 0 && <div class="empty">keine Markdown-Dokumente im Projekt</div>}
        {docs !== null &&
          groupDocs(docs).map((group) => (
            <div key={group.dir} class="doc-group">
              <div class="doc-group-dir mono dim">{dirLabel(group.dir)}</div>
              {group.items.map((doc) => (
                <button key={doc.path} type="button" class="doc-item" onClick={() => setViewing({ path: doc.path })}>
                  <span class="doc-item-name">{doc.title ?? docName(doc)}</span>
                  <span class="doc-item-path mono dim">{doc.path}</span>
                </button>
              ))}
            </div>
          ))}
      </div>

      {viewing && <DocViewer project={project} path={viewing.path} snippet={viewing.snippet} onClose={() => setViewing(null)} />}
    </div>
  );
}

/**
 * Strukturierte Dokumentansicht: gerendertes Markdown statt Code-Ansicht —
 * keine Zeilennummern, kein Syntax-Highlight (das hier ist Doku, nicht
 * Quelle). Aus einem Suchtreffer heraus wird der Abschnitt, der das
 * Snippet enthält, markiert und angesprungen.
 */
function DocViewer({ project, path, snippet, onClose }: { project: string; path: string; snippet?: string; onClose: () => void }) {
  const api = useApi();
  const [file, setFile] = useState<ProjectFile | null>(null);
  const [error, setError] = useState("");
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    setFile(null);
    setError("");
    api
      .searchFile(project, path)
      .then((f) => alive && setFile(f))
      .catch((err) => alive && setError(err instanceof Error ? err.message : "Dokument konnte nicht geladen werden"));
    return () => {
      alive = false;
    };
  }, [project, path]);

  // Erst nach dem Rendern: den Block suchen, der das Snippet enthält — der
  // Textkontext ist im DOM normalisiert (Whitespace kollabiert), weil
  // Markdown-Blöcke Zwischenräume beim Rendern verändern.
  useEffect(() => {
    if (!file || !snippet || !bodyRef.current) return;
    const anchor = snippetAnchor(snippet);
    if (!anchor) return;
    const norm = (s: string) => s.replace(/\s+/g, " ");
    const hit = [...bodyRef.current.querySelectorAll<HTMLElement>(".markdown > *")].find((el) =>
      norm(el.textContent ?? "").includes(anchor),
    );
    if (hit) {
      hit.classList.add("doc-hit");
      hit.scrollIntoView({ block: "center" });
    }
  }, [file, snippet]);

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
            <div class="doc-prose">
              <Markdown text={file.content} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
