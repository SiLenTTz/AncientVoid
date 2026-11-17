import { useEffect, useState } from "preact/hooks";
import type { CodeFile } from "@ancientvoid/contracts";
import { hostApi } from "../../shared/api.ts";

/**
 * BUG-0191: Datei-Inhalt einer Git-Revision (nicht Worktree).
 * Read-only; gelöschte Pfade kommen über Parent-Fallback vom Server.
 */
export function HistoricalBlobView({
  target,
  path,
  sha,
  hostId = null,
}: {
  target: string;
  path: string;
  sha: string;
  hostId?: string | null;
}) {
  const api = hostApi(hostId);
  const [file, setFile] = useState<CodeFile | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    setFile(null);
    setError("");
    api
      .codeFileAt(target, path, sha)
      .then((f) => {
        if (alive) setFile(f);
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : "Historie-Datei nicht lesbar");
      });
    return () => {
      alive = false;
    };
  }, [api, target, path, sha]);

  if (error) return <div class="files-error" role="alert" data-testid="historical-blob-error">{error}</div>;
  if (!file) return <div class="empty">lädt Historie …</div>;

  return (
    <div class="file-viewer historical-blob" data-testid="historical-blob-view">
      <div class="file-viewer-head">
        <span class="mono file-viewer-path" title={file.path}>{file.path}</span>
        <span class="dim">{file.language} · {file.bytes} B · {file.lines} Zeilen</span>
      </div>
      <div class="dim file-note" data-testid="historical-blob-banner" role="status">
        Historie @ {sha.slice(0, 7)} — Stand dieser Revision (nicht der aktuelle Worktree)
        {file.truncated ? " · Inhalt gekappt" : ""}
        {file.binary ? " · Binärdatei (kein Text)" : ""}
      </div>
      {file.binary ? (
        <div class="empty">Binärinhalt — kein Textvorschau für diesen Blob.</div>
      ) : (
        <pre class="historical-blob-source mono" data-testid="historical-blob-source">{file.content}</pre>
      )}
    </div>
  );
}
