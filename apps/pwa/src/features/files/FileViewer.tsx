import { useEffect, useState } from "preact/hooks";
import type { DiagnosticsResult, FileMeta } from "@ancientvoid/contracts";
import { hostApi, type HubApi } from "../../shared/api.ts";
import { BLOB_MAX_BYTES, HEX_PAGE_BYTES, formatBytes, hexRows, metaSummary } from "./files-model.ts";
import { DiagnosticsPanel } from "./DiagnosticsPanel.tsx";
import { FeedbackPanel } from "./FeedbackPanel.tsx";
import { RenderedView, renderKindOf } from "./RenderedViews.tsx";
import { SourceView, type Jump } from "./SourceView.tsx";
import { Button, Chip, EmptyState } from "../../shared/ui/index.ts";

type Mode = "preview" | "rendered" | "source" | "hex";

/**
 * EPIC-P46 T46.5/T46.6 (ADR-0058): eine Datei bis zum letzten Byte — immer genau ein Abschnitt im DOM
 * (Speicherbudget), jeder Abschnitt an die Revision gebunden. Änderungen während des Lesens werden gemeldet,
 * nie gemischt. Medien als Blob (nur bis BLOB_MAX_BYTES), alles andere über Quelltext/Hex.
 */
export function FileViewer({ target, path, hostId = null, sessionId = null, onChangedOnDisk }: { target: string; path: string; hostId?: string | null; sessionId?: string | null; onChangedOnDisk?: () => void }) {
  const api = hostApi(hostId);
  const [meta, setMeta] = useState<FileMeta | null>(null);
  const [error, setError] = useState("");
  const [stale, setStale] = useState(false);
  const [mode, setMode] = useState<Mode>("source");
  const [reload, setReload] = useState(0);
  const [diag, setDiag] = useState<DiagnosticsResult | null>(null);
  const [jump, setJump] = useState<Jump | null>(null);
  const [showDiag, setShowDiag] = useState(false);
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  useEffect(() => {
    let alive = true;
    setMeta(null);
    setError("");
    setStale(false);
    setDiag(null);
    api
      .codeMeta(target, path)
      .then((m) => {
        if (!alive) return;
        setMeta(m);
        setMode(renderKindOf(m) && m.family !== "text" ? "rendered" : m.family === "text" ? "source" : m.family === "binary" ? "hex" : "preview");
      })
      .catch((err) => alive && setError(err instanceof Error ? err.message : "Datei nicht lesbar"));
    return () => {
      alive = false;
    };
  }, [target, path, reload, hostId]);

  const markStale = () => {
    setStale(true);
    onChangedOnDisk?.();
  };

  if (error) return <div class="files-error" role="alert">{error}</div>;
  if (!meta) return <EmptyState text="lädt …" />;
  const kind = renderKindOf(meta);
  const local = !hostId;
  const canPreview = meta.family === "image" || meta.family === "pdf" || meta.family === "audio" || meta.family === "video";
  return (
    <div class="file-viewer" data-testid="file-viewer">
      <div class="file-viewer-head">
        <span class="mono file-viewer-path" title={meta.path}>{meta.path}</span>
        <span class="dim">{metaSummary(meta)}</span>
        <span class="file-viewer-modes" role="group" aria-label="Ansicht">
          {kind && <Chip  onClick={() => setMode("rendered")} active={mode === "rendered"}>Ansicht</Chip>}
          {canPreview && <Chip  onClick={() => setMode("preview")} active={mode === "preview"}>Vorschau</Chip>}
          {meta.family === "text" && <Chip  onClick={() => setMode("source")} active={mode === "source"}>Text</Chip>}
          <Chip  onClick={() => setMode("hex")} active={mode === "hex"}>Hex</Chip>
          {meta.family === "text" && local && <Chip  aria-pressed={showDiag} onClick={() => setShowDiag(!showDiag)} active={showDiag}>Diagnose</Chip>}
          <DownloadButton api={api} target={target} meta={meta} />
        </span>
      </div>
      <div class="dim file-note" data-testid="file-freshness" role="status">
        Stand der Datei: {new Date(meta.mtimeMs).toLocaleString("de-DE")} · Revision {meta.revision.slice(0, 8)}
        {!online && " · offline — nur bereits geladene Abschnitte, weitere Bereiche folgen nach Reconnect"}
      </div>
      {stale && (
        <div class="files-stale" role="alert">
          Die Datei hat sich geändert (Agent oder Editor). Bisher gelesene Abschnitte passen nicht mehr zusammen.{" "}
          <Button onClick={() => setReload((n) => n + 1)}>Neu laden</Button>
        </div>
      )}
      {showDiag && meta.family === "text" && local && (
        <DiagnosticsPanel api={api} target={target} meta={meta} result={diag} onResult={setDiag} onJump={(line, column) => { setMode("source"); setJump({ line, column, nonce: Date.now() }); }} />
      )}
      {mode === "source" && meta.family === "text" && <SourceView api={api} target={target} meta={meta} onStale={markStale} diagnostics={diag} jump={jump} />}
      {mode === "rendered" && kind && <RenderedView api={api} target={target} meta={meta} kind={kind} onStale={markStale} />}
      {mode === "hex" && <HexPages api={api} target={target} meta={meta} onStale={markStale} />}
      {mode === "preview" && canPreview && <MediaPreview api={api} target={target} meta={meta} onUnplayable={() => setMode("hex")} />}
      <FeedbackPanel api={api} sessionId={local ? sessionId : null} />
    </div>
  );
}

function useRevisionGuard(onStale: () => void) {
  return (err: unknown): string => {
    const message = err instanceof Error ? err.message : "Lesen fehlgeschlagen";
    if (/geändert/.test(message)) onStale();
    return message;
  };
}

function Pager({ offset, length, total, hasPrev, hasNext, onPrev, onNext, onJump }: { offset: number; length: number; total: number; hasPrev: boolean; hasNext: boolean; onPrev: () => void; onNext: () => void; onJump: (byte: number) => void }) {
  const [jump, setJump] = useState("");
  return (
    <div class="file-pager">
      <Button disabled={!hasPrev} onClick={onPrev} aria-label="Voriger Abschnitt">‹</Button>
      <span class="dim" data-testid="file-pager-range">
        Bytes {offset.toLocaleString("de-DE")}–{(offset + length).toLocaleString("de-DE")} von {total.toLocaleString("de-DE")}
        {!hasNext && " · Ende"}
      </span>
      <Button disabled={!hasNext} onClick={onNext} aria-label="Nächster Abschnitt">›</Button>
      <input
        class="file-pager-jump"
        inputMode="numeric"
        placeholder="Byte-Offset"
        aria-label="Zu Byte-Offset springen"
        value={jump}
        onInput={(e) => setJump((e.target as HTMLInputElement).value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && /^\d+$/.test(jump)) onJump(Math.min(Number(jump), Math.max(total - 1, 0)));
        }}
      />
    </div>
  );
}

function HexPages({ api, target, meta, onStale }: { api: HubApi; target: string; meta: FileMeta; onStale: () => void }) {
  const [at, setAt] = useState(0);
  const [rows, setRows] = useState<{ offset: string; hex: string; ascii: string }[] | null>(null);
  const [len, setLen] = useState(0);
  const [error, setError] = useState("");
  const guard = useRevisionGuard(onStale);
  useEffect(() => {
    let alive = true;
    setError("");
    api
      .codeRange(target, meta.path, { offset: at, length: HEX_PAGE_BYTES, rev: meta.revision, as: "bytes" })
      .then((r) => {
        if (!alive) return;
        setLen(r.length);
        setRows(hexRows(r.base64 ?? "", r.offset));
      })
      .catch((err) => alive && setError(guard(err)));
    return () => {
      alive = false;
    };
  }, [target, meta.path, meta.revision, at]);
  if (error) return <div class="files-error" role="alert">{error}</div>;
  if (meta.bytes === 0) return <EmptyState text="Leere Datei (0 Bytes)." />;
  if (!rows) return <EmptyState text="lädt …" />;
  return (
    <>
      <Pager
        offset={at}
        length={len}
        total={meta.bytes}
        hasPrev={at > 0}
        hasNext={at + len < meta.bytes}
        onPrev={() => setAt(Math.max(at - HEX_PAGE_BYTES, 0))}
        onNext={() => setAt(at + len)}
        onJump={(byte) => setAt(byte - (byte % 16))}
      />
      <pre class="file-hex mono" data-testid="file-hex">{rows.map((r) => `${r.offset}  ${r.hex.padEnd(47)}  ${r.ascii}`).join("\n")}</pre>
    </>
  );
}

function MediaPreview({ api, target, meta, onUnplayable }: { api: HubApi; target: string; meta: FileMeta; onUnplayable: () => void }) {
  const [playError, setPlayError] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState("");
  const tooBig = meta.bytes > BLOB_MAX_BYTES;
  useEffect(() => {
    if (tooBig) return;
    let alive = true;
    let made: string | null = null;
    api
      .codeRawUrl(target, meta.path, meta.revision)
      .then((u) => {
        made = u;
        if (alive) setUrl(u);
        else URL.revokeObjectURL(u);
      })
      .catch((err) => alive && setError(err instanceof Error ? err.message : "Vorschau fehlgeschlagen"));
    return () => {
      alive = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [target, meta.path, meta.revision]);
  if (tooBig) return <div class="files-error" role="status">{formatBytes(meta.bytes)} ist zu groß für eine Vorschau (Grenze {formatBytes(BLOB_MAX_BYTES)}). Die Hex-Ansicht liest die Datei bis zum letzten Byte.</div>;
  if (error) return <div class="files-error" role="alert">{error} — Hex zeigt die Originalbytes.</div>;
  if (!url) return <EmptyState text="lädt …" />;
  if (playError) {
    return (
      <div class="files-error" role="status">
        Dieser Browser kann die Datei nicht abspielen/anzeigen (Codec/Format). Download oder Hex zeigen die Originalbytes.{" "}
        <Button onClick={onUnplayable}>Hex öffnen</Button>
      </div>
    );
  }
  // Passiv: <img>/<audio>/<video> führen keine Skripte aus; PDF nur im sandboxed iframe ohne Rechte.
  if (meta.family === "image") return <img class="file-media" src={url} alt={meta.path} onError={() => setPlayError(true)} />;
  if (meta.family === "audio") return <audio class="file-media" src={url} controls onError={() => setPlayError(true)} />;
  if (meta.family === "video") return <video class="file-media" src={url} controls onError={() => setPlayError(true)} />;
  // PDF braucht einen eingebauten Viewer; ohne ihn bleibt der Download (kein stilles Leerfeld).
  if (typeof navigator !== "undefined" && navigator.pdfViewerEnabled === false) {
    return <div class="files-error" role="status">Dieser Browser zeigt PDFs nicht inline an — bitte „Download“ nutzen.</div>;
  }
  return <iframe class="file-pdf" title={meta.path} src={url} sandbox="" />;
}

function DownloadButton({ api, target, meta }: { api: HubApi; target: string; meta: FileMeta }) {
  const [busy, setBusy] = useState(false);
  if (meta.bytes > BLOB_MAX_BYTES * 4) return <span class="dim" title="Zu groß für den Browser-Speicher — Hex liest bis zum letzten Byte">kein Download</span>;
  return (
    <Chip
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const url = await api.codeRawUrl(target, meta.path, meta.revision);
          const a = document.createElement("a");
          a.href = url;
          a.download = meta.path.split("/").pop() ?? "datei";
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 10_000);
        } finally {
          setBusy(false);
        }
      }}
    >
      Download
    </Chip>
  );
}
