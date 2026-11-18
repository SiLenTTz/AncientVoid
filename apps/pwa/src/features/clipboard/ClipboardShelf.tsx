import { useEffect, useState } from "preact/hooks";
import { Sheet } from "../../shared/ui/Sheet.tsx";
import { Button, EmptyState } from "../../shared/ui/index.ts";
import { ago } from "../../shared/status.ts";
import { pasteTranscript } from "../stt/paste-target.ts";
import {
  clearShelf,
  closeClipboardShelf,
  dropShelf,
  OPEN_SHELF_EVENT,
  SHELF_EVENT,
  SHELF_LEVELS,
  SHELF_MAX,
  SHELF_ORIGIN_LABEL,
  useShelf,
  visibleShelf,
  type ShelfEntry,
} from "../../shared/clipboard-shelf.ts";

/** Ablage-Stufen dieses Geräts — für Knöpfe ausserhalb des Blatts (Composer). */
export function useShelfCount(): number {
  const [count, setCount] = useState(() => visibleShelf().length);
  useEffect(() => {
    const on = () => setCount(visibleShelf().length);
    window.addEventListener(SHELF_EVENT, on);
    return () => window.removeEventListener(SHELF_EVENT, on);
  }, []);
  return count;
}

/** Zwei Blätter versetzt übereinander — die Ablage ist ein Stapel, keine Zeilenliste.
 *  Die frühere Form mit vier Strichen las sich als Textausrichtung, nicht als Stapel. */
function ShelfGlyph() {
  return (
    <svg viewBox="0 0 24 24" width={20} height={20} fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <rect x="8.5" y="4.5" width="11" height="11" rx="2.5" />
      <path d="M15.5 19.5h-9a2.5 2.5 0 0 1-2.5-2.5v-9" />
    </svg>
  );
}

/**
 * ADR-0090: die mehrstufige Zwischenablage. Sechs Stufen sichtbar, jede mit Einfügen,
 * Zurückholen und Entfernen. Was hier steht, liegt nur in diesem Browser — der Hinweis am
 * Ende ist keine Deko, er ist die Zusage des Designs.
 */
export function ClipboardShelf() {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<ShelfEntry[]>(() => visibleShelf());
  const [note, setNote] = useState("");
  const [armed, setArmed] = useState(false);

  const sync = () => setEntries(visibleShelf());
  useEffect(() => {
    const open_ = () => {
      sync();
      setNote("");
      setArmed(false);
      setOpen(true);
    };
    const close = () => setOpen(false);
    window.addEventListener(OPEN_SHELF_EVENT, open_);
    window.addEventListener(`${OPEN_SHELF_EVENT}:close`, close);
    window.addEventListener(SHELF_EVENT, sync);
    return () => {
      window.removeEventListener(OPEN_SHELF_EVENT, open_);
      window.removeEventListener(`${OPEN_SHELF_EVENT}:close`, close);
      window.removeEventListener(SHELF_EVENT, sync);
    };
  }, []);
  useEffect(() => {
    if (!armed) return;
    const t = window.setTimeout(() => setArmed(false), 4000);
    return () => window.clearTimeout(t);
  }, [armed]);

  const insert = async (entry: ShelfEntry) => {
    useShelf(entry.id);
    const where = await pasteTranscript(entry.text, { shelve: false });
    if (where === "nowhere") {
      const ok = await copyBack(entry);
      setNote(ok ? "kein Feld fokussiert — in die Zwischenablage geholt" : "weder Feld noch Zwischenablage — Text hier ablesen");
      return;
    }
    setOpen(false);
  };

  const copyBack = async (entry: ShelfEntry): Promise<boolean> => {
    useShelf(entry.id);
    if (!navigator.clipboard) return false;
    try {
      await navigator.clipboard.writeText(entry.text);
      setNote("in die Zwischenablage zurückgeholt");
      return true;
    } catch {
      setNote("Zwischenablage nicht erlaubt — Text hier ablesen");
      return false;
    }
  };

  const remove = (entry: ShelfEntry) => {
    dropShelf(entry.id);
    sync();
  };

  const clearAll = () => {
    if (!armed) {
      setArmed(true);
      return;
    }
    clearShelf();
    setArmed(false);
    sync();
    setNote("Ablage geleert");
  };

  return (
    <Sheet open={open} onClose={() => setOpen(false)} label="Zwischenablage-Ablage" testid="clipboard-shelf">
      <div class="shelf">
        <header class="shelf-head">
          <h2 class="shelf-title">Ablage</h2>
          <p class="shelf-sub">
            {entries.length === 0 ? "leer" : `${entries.length} von ${SHELF_MAX} Stufen`} · neueste zuerst
          </p>
          {entries.length > 0 && (
            <button
              type="button"
              class="link-btn shelf-clear"
              data-testid="shelf-clear"
              onClick={clearAll}
              title="Erstmal tippen fragt nach, nochmal tippen leert"
            >
              {armed ? "wirklich alles löschen?" : "alle löschen"}
            </button>
          )}
        </header>

        {entries.length === 0 ? (
          <EmptyState
            icon={<ShelfGlyph />}
            text="Noch nichts abgelegt. Was die App kopiert — Diktat, Markierung, Befehl, Eintrag — liegt eine Stufe tiefer hier; Token bleiben draußen."
            action={<Button size="sm" onClick={() => setOpen(false)}>schließen</Button>}
          />
        ) : (
          <ul class="shelf-list" data-testid="shelf-list">
            {entries.map((entry, index) => (
              <li class="shelf-row" data-testid="shelf-row" key={entry.id}>
                <span class="shelf-step" aria-hidden="true">{index + 1}</span>
                <div class="shelf-body">
                  <p class="shelf-text">{entry.text}</p>
                <div class="shelf-meta">
                  <span class="shelf-origin">{SHELF_ORIGIN_LABEL[entry.origin]}</span>
                  <span class="dim">{ago(entry.at)}</span>
                  {entry.uses > 0 && <span class="dim">{entry.uses + 1}× geholt</span>}
                  {entry.cut && <span class="dim">gekürzt</span>}
                </div>
                {/* Eine echte Taste, der Rest als Textstelle — sechs Reihen mit drei
                    gleich grossen Knöpfen schreien, und "einfügen" ist die Entscheidung. */}
                <div class="shelf-actions">
                  <Button size="sm" data-testid="shelf-insert" onClick={() => void insert(entry)}>Einfügen</Button>
                  <button type="button" class="link-btn shelf-copy" data-testid="shelf-copy" onClick={() => void copyBack(entry)}>in die Zwischenablage</button>
                  <span class="shelf-dot" aria-hidden="true">·</span>
                  <button type="button" class="link-btn shelf-drop" data-testid="shelf-drop" onClick={() => remove(entry)}>entfernen</button>
                </div>
                </div>
              </li>
            ))}
          </ul>
        )}

        {note && <p class="shelf-note" role="status" data-testid="shelf-note">{note}</p>}
        <p class="shelf-privacy">
          Nur auf diesem Gerät in diesem Browser — die Ablage geht nie zum Hub. Sichtbar sind {SHELF_LEVELS} Stufen, gemerkt bis {SHELF_MAX}.
        </p>
      </div>
    </Sheet>
  );
}

export { ShelfGlyph, closeClipboardShelf };
