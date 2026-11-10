import { useEffect, useState } from "preact/hooks";
import type { VaultBrowse, VaultFile, VaultState } from "@ancientvoid/contracts";
import { hubApi } from "../../shared/api.ts";
import { FileViewer } from "../files/FileViewer.tsx";
import { formatBytes } from "../files/files-model.ts";
import { openPopout } from "../windows/windows.ts";
import { vaultFileHash } from "../../app/route.ts";

/**
 * EPIC-P49 (ADR-0063): Knowledge Vault — Notizen des Menschen in einem gewählten Ordner.
 * Erstnutzung wählt den Ordner über den serverseitigen Verzeichnis-Browser; Markdown ist
 * editierbar (explizites Speichern mit Revision-Guard), alles andere reine Ansicht.
 */
export function VaultPane({ initialFile = null }: { initialFile?: string | null }) {
  const [state, setState] = useState<VaultState | null>(null);
  const [loadError, setLoadError] = useState("");
  const [files, setFiles] = useState<VaultFile[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [selected, setSelected] = useState<string | null>(initialFile);
  const [editMode, setEditMode] = useState(false);
  const [text, setText] = useState("");
  const [revision, setRevision] = useState("");
  const [editorError, setEditorError] = useState("");
  const [stale, setStale] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [picker, setPicker] = useState(false);
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

  const reloadState = () => {
    hubApi
      .vaultState()
      .then((s) => {
        setState(s);
        setLoadError("");
        setPicker(!s.configured);
      })
      .catch((err: unknown) => setLoadError(err instanceof Error ? err.message : "Vault-Status nicht erreichbar."));
  };
  useEffect(reloadState, []);

  useEffect(() => {
    // Deep-Link nach dem Mount (hashchange lädt die Seite nicht neu).
    if (initialFile) setSelected(initialFile);
  }, [initialFile]);

  const reloadFiles = () => {
    if (!state?.configured) return;
    hubApi
      .vaultFiles()
      .then((l) => {
        setFiles(l.files);
        setTruncated(l.truncated);
      })
      .catch((err: unknown) => setLoadError(err instanceof Error ? err.message : "Vault-Liste nicht erreichbar."));
  };
  useEffect(reloadFiles, [state?.configured]);

  const openFile = (path: string, edit = false) => {
    setSelected(path);
    setEditMode(false);
    setEditorError("");
    setStale(false);
    setDirty(false);
    if (edit) void enterEdit(path);
    else location.hash = vaultFileHash(path);
  };

  const enterEdit = (path: string) => {
    hubApi
      .vaultRead(path)
      .then((r) => {
        if (r.text === null) {
          setEditorError(`Datei zu groß für den Editor (${formatBytes(r.bytes)}) — Ansehen funktioniert.`);
          return;
        }
        setText(r.text);
        setRevision(r.revision);
        setEditMode(true);
        setEditorError("");
        setStale(false);
        setDirty(false);
      })
      .catch((err: unknown) => setEditorError(err instanceof Error ? err.message : "Nicht lesbar."));
  };

  const save = () => {
    if (!selected || saving) return;
    setSaving(true);
    hubApi
      .vaultSave(selected, text, revision)
      .then((r) => {
        setRevision(r.revision);
        setDirty(false);
        setStale(false);
        setSaving(false);
      })
      .catch((err: unknown) => {
        setSaving(false);
        if (err instanceof Error && err.message.includes("geändert")) setStale(true);
        else setEditorError(err instanceof Error ? err.message : "Speichern fehlgeschlagen.");
      });
  };

  const create = () => {
    const name = newName.trim();
    if (name === "" || creating) return;
    setCreating(true);
    hubApi
      .vaultCreate(name)
      .then((f) => {
        setCreating(false);
        setNewName("");
        reloadFiles();
        openFile(f.path, true);
      })
      .catch((err: unknown) => {
        setCreating(false);
        setEditorError(err instanceof Error ? err.message : "Anlegen fehlgeschlagen.");
      });
  };

  if (loadError && !state) return <div class="files-error" role="alert">{loadError}</div>;
  if (!state) return <div class="empty">Vault lädt…</div>;
  if (picker) {
    return (
      <VaultPicker
        onDone={(s) => {
          setState(s);
          setPicker(false);
        }}
      />
    );
  }

  const current = files?.find((f) => f.path === selected) ?? null;
  return (
    <div class="vault-pane" data-testid="vault-pane">
      <div class="vault-head">
        <span class="vault-title" title={state.root ?? undefined}>📂 {state.label}</span>
        <button type="button" class="btn" onClick={() => setPicker(true)}>Ordner wechseln</button>
      </div>
      <div class="vault-new">
        <input
          type="text"
          placeholder="Neue Notiz (nur .md)"
          aria-label="Neue Notiz"
          value={newName}
          onInput={(e) => setNewName((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => e.key === "Enter" && create()}
        />
        <button type="button" class="btn" onClick={create} disabled={creating || newName.trim() === ""}>Anlegen</button>
      </div>
      {editorError && <div class="files-error" role="alert">{editorError}</div>}
      {truncated && <div class="graph-banner">Liste gekappt — sehr viele Dateien im Vault-Ordner.</div>}
      <div class="vault-body">
        <ul class="vault-list" role="list">
          {(files ?? []).map((f) => (
            <li key={f.path}>
              <button
                type="button"
                class={`vault-row${selected === f.path ? " active" : ""}`}
                onClick={() => openFile(f.path)}
              >
                <span class="vault-name">{f.path.includes("/") ? <span class="dim">{f.path.slice(0, f.path.lastIndexOf("/") + 1)}</span> : null}{f.path.split("/").pop()}</span>
                <span class="dim vault-meta">{f.editable ? "" : "Ansehen · "}{formatBytes(f.bytes)}</span>
              </button>
            </li>
          ))}
          {files !== null && files.length === 0 && <li class="empty">noch keine Dateien — lege eine Notiz an</li>}
        </ul>
        {selected && (
          <div class="vault-file">
            <div class="vault-file-head">
              <strong class="vault-file-name">{selected.split("/").pop()}</strong>
              {current?.editable && (
                <>
                  {editMode ? (
                    <button type="button" class="btn" onClick={() => { setEditMode(false); openFile(selected); }}>Ansehen</button>
                  ) : (
                    <button type="button" class="btn" onClick={() => void enterEdit(selected)}>Bearbeiten</button>
                  )}
                </>
              )}
              <button type="button" class="btn" aria-label="Datei in eigenes Fenster" onClick={() => void openPopout({ kind: "vault", path: selected })}>⧉ Eigenes Fenster</button>
            </div>
            {editMode ? (
              <div class="vault-editor">
                {stale && <div class="files-error" role="alert">Die Notiz hat sich unterdessen geändert — neu laden und erneut versuchen (kein stiller Verlust).</div>}
                {!online && <div class="graph-banner">Offline — Speichern gesperrt, der Text bleibt im Fenster.</div>}
                <textarea
                  class="vault-textarea"
                  spellcheck={false}
                  value={text}
                  onInput={(e) => {
                    setText((e.target as HTMLTextAreaElement).value);
                    setDirty(true);
                  }}
                />
                <div class="vault-editor-actions">
                  <button type="button" class="btn" onClick={save} disabled={!dirty || saving || !online}>{saving ? "Speichere …" : "Speichern"}</button>
                  <span class="dim">{dirty ? "ungespeichert" : "gespeichert"}</span>
                </div>
              </div>
            ) : (
              <FileViewer target="vault=1" path={selected} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** Serverseitiger Verzeichnis-Browser zur Root-Wahl (ADR-0063 §2): Startpunkte, containment-geprüft. */
function VaultPicker({ onDone }: { onDone: (state: VaultState) => void }) {
  const [browse, setBrowse] = useState<VaultBrowse | null>(null);
  const [path, setPath] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    hubApi
      .vaultBrowse(path ?? undefined)
      .then(setBrowse)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Ordnerliste nicht erreichbar."));
  }, [path]);

  const choose = () => {
    if (!path || busy) return;
    setBusy(true);
    hubApi
      .vaultSetRoot(path)
      .then((s) => {
        setBusy(false);
        onDone(s);
      })
      .catch((err: unknown) => {
        setBusy(false);
        setError(err instanceof Error ? err.message : "Ordner nicht wählbar.");
      });
  };

  return (
    <div class="vault-picker" data-testid="vault-picker">
      <h2>Zielordner für Notizen wählen</h2>
      <p class="dim">Der Knowledge Vault legt und bearbeitet ausschließlich Markdown-Dateien in diesem Ordner.</p>
      {error && <div class="files-error" role="alert">{error}</div>}
      {browse && (
        <>
          <div class="vault-crumbs">
            {browse.path === "" ? <span class="dim">Startpunkte</span> : <button type="button" class="btn" onClick={() => setPath(browse.parent)}>← übergeordneter Ordner</button>}
            {browse.path !== "" && <code class="vault-path">{browse.path}</code>}
          </div>
          <ul class="vault-list">
            {browse.roots.map((r) => (
              <li key={r.path}>
                <button type="button" class="vault-row" onClick={() => setPath(r.path)}>
                  <span class="vault-name">📁 {r.name}</span>
                  <span class="dim vault-meta">Startpunkt</span>
                </button>
              </li>
            ))}
            {browse.dirs.map((d) => (
              <li key={d.path}>
                <button type="button" class="vault-row" onClick={() => setPath(d.path)}>
                  <span class="vault-name">📁 {d.name}</span>
                </button>
              </li>
            ))}
          </ul>
          {browse.path !== "" && (
            <button type="button" class="btn vault-choose" onClick={choose} disabled={busy} data-testid="vault-choose">
              {busy ? "Wähle …" : "Diesen Ordner verwenden"}
            </button>
          )}
        </>
      )}
      {!browse && !error && <div class="empty">Ordner laden …</div>}
    </div>
  );
}
