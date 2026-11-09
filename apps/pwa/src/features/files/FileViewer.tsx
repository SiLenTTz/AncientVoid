import { useEffect, useState } from "preact/hooks";
import type { FileMeta } from "@ancientvoid/contracts";
import { hubApi } from "../../shared/api.ts";
import { BLOB_MAX_BYTES, HEX_PAGE_BYTES, TEXT_PAGE_BYTES, formatBytes, hexRows, metaSummary } from "./files-model.ts";

type Mode = "preview" | "source" | "hex";

/**
 * EPIC-P46 T46.5/T46.6 (ADR-0058): eine Datei bis zum letzten Byte — immer genau ein Abschnitt im DOM
 * (Speicherbudget), jeder Abschnitt an die Revision gebunden. Änderungen während des Lesens werden gemeldet,
 * nie gemischt. Medien als Blob (nur bis BLOB_MAX_BYTES), alles andere über Quelltext/Hex.
 */
export function FileViewer({ target, path, onChangedOnDisk }: { target: string; path: string; onChangedOnDisk?: () => void }) {
  const [meta, setMeta] = useState<FileMeta | null>(null);
  const [error, setError] = useState("");
  const [stale, setStale] = useState(false);
  const [mode, setMode] = useState<Mode>("source");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let alive = true;
    setMeta(null);
    setError("");
    setStale(false);
    hubApi
      .codeMeta(target, path)
      .then((m) => {
        if (!alive) return;
        setMeta(m);
        setMode(m.family === "text" ? "source" : m.family === "binary" ? "hex" : "preview");
      })
      .catch((err) => alive && setError(err instanceof Error ? err.message : "Datei nicht lesbar"));
    return () => {
      alive = false;
    };
  }, [target, path, reload]);

  const markStale = () => {
    setStale(true);
    onChangedOnDisk?.();
  };

  if (error) return <div class="files-error" role="alert">{error}</div>;
  if (!meta) return <div class="empty">lädt …</div>;
  const canPreview = meta.family === "image" || meta.family === "pdf" || meta.family === "audio" || meta.family === "video";
  return (
    <div class="file-viewer" data-testid="file-viewer">
      <div class="file-viewer-head">
        <span class="mono file-viewer-path" title={meta.path}>{meta.path}</span>
        <span class="dim">{metaSummary(meta)}</span>
        <span class="file-viewer-modes" role="group" aria-label="Ansicht">
          {canPreview && <button type="button" class={mode === "preview" ? "chip active" : "chip"} onClick={() => setMode("preview")}>Vorschau</button>}
          {meta.family === "text" && <button type="button" class={mode === "source" ? "chip active" : "chip"} onClick={() => setMode("source")}>Text</button>}
          <button type="button" class={mode === "hex" ? "chip active" : "chip"} onClick={() => setMode("hex")}>Hex</button>
          <DownloadButton target={target} meta={meta} />
        </span>
      </div>
      {stale && (
        <div class="files-stale" role="alert">
          Die Datei hat sich geändert (Agent oder Editor). Bisher gelesene Abschnitte passen nicht mehr zusammen.{" "}
          <button type="button" class="btn" onClick={() => setReload((n) => n + 1)}>Neu laden</button>
        </div>
      )}
      {mode === "source" && meta.family === "text" && <TextPages target={target} meta={meta} onStale={markStale} />}
      {mode === "hex" && <HexPages target={target} meta={meta} onStale={markStale} />}
      {mode === "preview" && canPreview && <MediaPreview target={target} meta={meta} />}
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
      <button type="button" class="btn" disabled={!hasPrev} onClick={onPrev} aria-label="Voriger Abschnitt">‹</button>
      <span class="dim" data-testid="file-pager-range">
        Bytes {offset.toLocaleString("de-DE")}–{(offset + length).toLocaleString("de-DE")} von {total.toLocaleString("de-DE")}
        {!hasNext && " · Ende"}
      </span>
      <button type="button" class="btn" disabled={!hasNext} onClick={onNext} aria-label="Nächster Abschnitt">›</button>
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

function TextPages({ target, meta, onStale }: { target: string; meta: FileMeta; onStale: () => void }) {
  const [page, setPage] = useState<{ offset: number; length: number; text: string; nextOffset: number | null } | null>(null);
  const [trail, setTrail] = useState<number[]>([]);
  const [at, setAt] = useState(meta.bomBytes);
  const [error, setError] = useState("");
  const [wrap, setWrap] = useState(false);
  const guard = useRevisionGuard(onStale);
  useEffect(() => {
    let alive = true;
    setError("");
    hubApi
      .codeRange(target, meta.path, { offset: at, length: TEXT_PAGE_BYTES, rev: meta.revision, as: "text", encoding: meta.encoding })
      .then((r) => alive && setPage({ offset: r.offset, length: r.length, text: r.text ?? "", nextOffset: r.nextOffset }))
      .catch((err) => alive && setError(guard(err)));
    return () => {
      alive = false;
    };
  }, [target, meta.path, meta.revision, at]);
  if (error) return <div class="files-error" role="alert">{error}</div>;
  if (!page) return <div class="empty">lädt …</div>;
  return (
    <>
      <Pager
        offset={page.offset}
        length={page.length}
        total={meta.bytes}
        hasPrev={trail.length > 0}
        hasNext={page.nextOffset !== null}
        onPrev={() => {
          const prev = trail[trail.length - 1]!;
          setTrail(trail.slice(0, -1));
          setAt(prev);
        }}
        onNext={() => {
          setTrail([...trail, at]);
          setAt(page.nextOffset!);
        }}
        onJump={(byte) => {
          setTrail([...trail, at]);
          setAt(Math.max(byte, meta.bomBytes));
        }}
      />
      <label class="dim file-wrap"><input type="checkbox" checked={wrap} onChange={(e) => setWrap((e.target as HTMLInputElement).checked)} /> Zeilen umbrechen</label>
      <pre class={wrap ? "file-text wrap" : "file-text"} data-testid="file-text" tabIndex={0}>{page.text}</pre>
    </>
  );
}

function HexPages({ target, meta, onStale }: { target: string; meta: FileMeta; onStale: () => void }) {
  const [at, setAt] = useState(0);
  const [rows, setRows] = useState<{ offset: string; hex: string; ascii: string }[] | null>(null);
  const [len, setLen] = useState(0);
  const [error, setError] = useState("");
  const guard = useRevisionGuard(onStale);
  useEffect(() => {
    let alive = true;
    setError("");
    hubApi
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
  if (meta.bytes === 0) return <div class="empty">Leere Datei (0 Bytes).</div>;
  if (!rows) return <div class="empty">lädt …</div>;
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

function MediaPreview({ target, meta }: { target: string; meta: FileMeta }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState("");
  const tooBig = meta.bytes > BLOB_MAX_BYTES;
  useEffect(() => {
    if (tooBig) return;
    let alive = true;
    let made: string | null = null;
    hubApi
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
  if (!url) return <div class="empty">lädt …</div>;
  // Passiv: <img>/<audio>/<video> führen keine Skripte aus; PDF nur im sandboxed iframe ohne Rechte.
  if (meta.family === "image") return <img class="file-media" src={url} alt={meta.path} />;
  if (meta.family === "audio") return <audio class="file-media" src={url} controls />;
  if (meta.family === "video") return <video class="file-media" src={url} controls />;
  return <iframe class="file-pdf" title={meta.path} src={url} sandbox="" />;
}

function DownloadButton({ target, meta }: { target: string; meta: FileMeta }) {
  const [busy, setBusy] = useState(false);
  if (meta.bytes > BLOB_MAX_BYTES * 4) return <span class="dim" title="Zu groß für den Browser-Speicher — Hex liest bis zum letzten Byte">kein Download</span>;
  return (
    <button
      type="button"
      class="chip"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const url = await hubApi.codeRawUrl(target, meta.path, meta.revision);
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
    </button>
  );
}
