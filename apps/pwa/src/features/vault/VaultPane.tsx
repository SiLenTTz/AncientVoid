import { openWorkspaceContent } from "../workspace/open-content.ts";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { VaultBrowse, VaultFile, VaultState } from "@ancientvoid/contracts";
import { hubApi } from "../../shared/api.ts";
import { FileViewer } from "../files/FileViewer.tsx";
import { formatBytes } from "../files/files-model.ts";
import { openPopout } from "../windows/windows.ts";
import { vaultFileHash } from "../../app/route.ts";
import { Button, EmptyState } from "../../shared/ui/index.ts";

const AUTOSAVE_MS = 600;

/**
 * EPIC-P49 (ADR-0063): Knowledge Vault — Notizen des Menschen in einem gewählten Ordner.
 * Suche nach Dateiname; Markdown mit debounced Auto-Save (kein manueller Speichern-Button).
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
  const [filter, setFilter] = useState("");

  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [picker, setPicker] = useState(false);
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const textRef = useRef(text);
  const revisionRef = useRef(revision);
  const selectedRef = useRef(selected);
  textRef.current = text;
  revisionRef.current = revision;
  selectedRef.current = selected;

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
  useEffect(reloadFiles, [state?.configured, state?.root]);

  const openFile = (path: string, edit = false) => {
    if (!edit && openWorkspaceContent({ sessionId: "", content: { kind: "page", page: "vault", vaultFile: path, hash: vaultFileHash(path) } })) return;
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
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

  const saveNow = (path: string, body: string, rev: string) => {
    if (!online) return;
    setSaving(true);
    hubApi
      .vaultSave(path, body, rev)
      .then((r) => {
        if (selectedRef.current !== path) return;
        setRevision(r.revision);
        setDirty(false);
        setStale(false);
        setSaving(false);
      })
      .catch((err: unknown) => {
        if (selectedRef.current !== path) return;
        setSaving(false);
        if (err instanceof Error && err.message.includes("geändert")) setStale(true);
        else setEditorError(err instanceof Error ? err.message : "Speichern fehlgeschlagen.");
      });
  };

  const scheduleSave = (nextText: string) => {
    setText(nextText);
    setDirty(true);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      const path = selectedRef.current;
      if (!path || !online) return;
      saveNow(path, textRef.current, revisionRef.current);
    }, AUTOSAVE_MS);
  };

  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
  }, []);

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

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!files) return null;
    if (!q) return files;
    return files.filter((f) => f.path.toLowerCase().includes(q) || (f.path.split("/").pop() ?? "").toLowerCase().includes(q));
  }, [files, filter]);

  if (loadError && !state) return <div class="files-error" role="alert">{loadError}</div>;
  if (!state) return <EmptyState text="Vault lädt…" />;
  if (picker) {
    return (
      <VaultPicker
        currentRoot={state.root}
        onDone={(s) => {
          setState(s);
          setPicker(false);
          // Neuer Root: alte Liste/Selektion sofort weg, bis die neue Liste steht.
          setSelected(null);
          setFilter("");
          setFiles(null);
          if (location.hash.startsWith("#/notizen/datei/")) location.hash = "#/notizen";
        }}
      />
    );
  }

  const current = files?.find((f) => f.path === selected) ?? null;
  return (
    <div class="vault-pane" data-testid="vault-pane">
      <div class="vault-head">
        <span class="vault-title" title={state.root ?? undefined}>📂 {state.label}</span>
        <Button onClick={() => setPicker(true)}>Ordner wechseln</Button>
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
        <Button onClick={create} disabled={creating || newName.trim() === ""}>Anlegen</Button>
      </div>
      <div class="vault-search">
        <input
          type="search"
          placeholder="Notiz suchen…"
          aria-label="Notiz suchen"
          data-testid="vault-search"
          value={filter}
          onInput={(e) => setFilter((e.target as HTMLInputElement).value)}
        />
      </div>
      {editorError && <div class="files-error" role="alert">{editorError}</div>}
      {truncated && <div class="graph-banner">Liste gekappt — sehr viele Dateien im Vault-Ordner.</div>}
      <div class="vault-body">
        <ul
          class="vault-list"
          role="list"
          onKeyDown={(e) => {
            // EPIC-P51 T51.6: Roving — ↑/↓ bewegen den Fokus zwischen den Notizen.
            if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
            const rows = [...(e.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>("button.vault-row")];
            const idx = rows.findIndex((r) => r === document.activeElement);
            if (idx === -1) return;
            const next = rows[idx + (e.key === "ArrowDown" ? 1 : -1)];
            if (!next) return;
            e.preventDefault();
            next.focus();
          }}
        >
          {(filtered ?? []).map((f) => (
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
          {filtered !== null && filtered.length === 0 && <EmptyState text={filter.trim() ? "keine Treffer" : "noch keine Dateien — lege eine Notiz an"} />}
        </ul>
        {selected && (
          <div class="vault-file">
            <div class="vault-file-head">
              <strong class="vault-file-name">{selected.split("/").pop()}</strong>
              {current?.editable && (
                <>
                  {editMode ? (
                    <Button onClick={() => { setEditMode(false); openFile(selected); }}>Ansehen</Button>
                  ) : (
                    <Button onClick={() => void enterEdit(selected)}>Bearbeiten</Button>
                  )}
                </>
              )}
              <Button aria-label="Datei in eigenes Fenster" onClick={() => void openPopout({ kind: "vault", path: selected })}>⧉ Eigenes Fenster</Button>
            </div>
            {editMode ? (
              <div class="vault-editor">
                {stale && <div class="files-error" role="alert">Die Notiz hat sich unterdessen geändert — neu laden und erneut versuchen (kein stiller Verlust).</div>}
                {!online && <div class="graph-banner">Offline — Speichern gesperrt, der Text bleibt im Fenster.</div>}
                <textarea
                  class="vault-textarea"
                  spellcheck={false}
                  value={text}
                  onInput={(e) => scheduleSave((e.target as HTMLTextAreaElement).value)}
                />
                <div class="vault-editor-actions" aria-live="polite">
                  <span class="dim" data-testid="vault-save-status">{saving ? "speichere …" : dirty ? "ungespeichert" : "gespeichert"}</span>
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

/** Serverseitiger Verzeichnis-Browser zur Root-Wahl (ADR-0063 §2): Startpunkte, containment-geprüft.
 * EPIC-P51 T51.3: dazu freie Pfad-Eingabe — Guards bleiben serverseitig, Ablehnungen als Klartext. */
function VaultPicker({ onDone, currentRoot = null }: { onDone: (state: VaultState) => void; currentRoot?: string | null }) {
  const [browse, setBrowse] = useState<VaultBrowse | null>(null);
  const [path, setPath] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [manualPath, setManualPath] = useState("");
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    hubApi
      .vaultBrowse(path ?? undefined)
      .then((b) => {
        setError("");
        setBrowse(b);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Ordnerliste nicht erreichbar."));
  }, [path]);

  const choose = () => {
    if (!path || busy || applying) return;
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

  const applyPath = () => {
    const p = manualPath.trim();
    if (p === "" || busy || applying) return;
    setApplying(true);
    hubApi
      .vaultSetRoot(p)
      .then((s) => {
        setApplying(false);
        onDone(s);
      })
      .catch((err: unknown) => {
        setApplying(false);
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
            {browse.path === "" ? <span class="dim">Startpunkte</span> : <Button onClick={() => setPath(browse.parent)}>← übergeordneter Ordner</Button>}
            {browse.path !== "" && <code class="vault-path">{browse.path}</code>}
          </div>
          <ul class="vault-list">
            {browse.roots.map((r) => (
              <li key={r.path}>
                <button type="button" class="vault-row" onClick={() => setPath(r.path)}>
                  <span class="vault-name">📁 {r.name}</span>
                  <span class="dim vault-meta">{r.path === currentRoot ? "Aktueller Ordner" : "Startpunkt"}</span>
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
            <Button onClick={choose} disabled={busy} data-testid="vault-choose" class="vault-choose">
              {busy ? "Wähle …" : "Diesen Ordner verwenden"}
            </Button>
          )}
        </>
      )}
      <div class="vault-manual">
        <input
          type="text"
          placeholder="… oder absoluten Pfad eingeben, z. B. /home/dev/notizen"
          aria-label="Vault-Ordner als Pfad eingeben"
          data-testid="vault-path-input"
          value={manualPath}
          onInput={(e) => setManualPath((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              applyPath();
            }
          }}
        />
        <Button onClick={applyPath} disabled={applying || manualPath.trim() === ""} data-testid="vault-path-apply">
          {applying ? "Wähle …" : "Pfad übernehmen"}
        </Button>
      </div>
      {!browse && !error && <div class="ui-empty">Ordner laden …</div>}
    </div>
  );
}
