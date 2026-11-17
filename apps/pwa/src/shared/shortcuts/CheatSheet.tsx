import { Sheet } from "../ui/index.ts";
import { useEffect, useState } from "preact/hooks";
import { activeShortcutIds, CATALOG, shortcut, type ShortcutInfo, registerShortcut } from "./registry.ts";

/**
 * EPIC-P51 T51.7: `?` öffnet die Kürzel-Übersicht — vollständig aus der
 * Registry generiert (keine zweite Liste pflegen): überall gültige Kürzel,
 * die gerade offenen Overlays (Esc) und Eingabe-Interaktion mit Ort.
 * Hergezogen aus EPIC-P43 T43.6; ersetzt die TileWorkspace-Hinweiszeile.
 * EPIC-P63 T63.8: Blatt über shared/ui/Sheet.
 */

function Row({ info }: { info: ShortcutInfo }) {
  return (
    <div class="cheatsheet-row">
      <span class="cheatsheet-key">{info.label}</span>
      <span class="cheatsheet-desc">
        {info.description}
        {info.where ? <span class="dim"> — {info.where}</span> : null}
      </span>
    </div>
  );
}

export function CheatSheet() {
  const [open, setOpen] = useState(false);
  const [live, setLive] = useState<string[]>([]);

  useEffect(() => {
    const offToggle = registerShortcut("cheatsheet.toggle", (e) => {
      e.preventDefault();
      setOpen((o) => {
        if (!o) setLive(activeShortcutIds());
        return !o;
      });
    });
    return offToggle;
  }, []);
  useEffect(() => {
    if (!open) return;
    return registerShortcut("cheatsheet.close", (e) => {
      e.preventDefault();
      setOpen(false);
    });
  }, [open]);

  if (!open) return null;
  const globalKm = CATALOG.filter((s) => s.scope === "global" && !s.hidden && !s.localOnly);
  const local = CATALOG.filter((s) => s.localOnly === true);
  // Kontext: Overlay-Esc-Kürzel, deren Panel gerade offen ist (Registry- live).
  const openOverlays = live
    .map((id) => shortcut(id))
    .filter((s): s is ShortcutInfo => s?.scope === "overlay" && s.id !== "cheatsheet.close");

  return (
    <Sheet open onClose={() => setOpen(false)} label="Kürzel-Übersicht" class="cheatsheet">
      <div class="row" style="justify-content: space-between; align-items: center">
        <strong>Tastatur-Kürzel</strong>
        <button class="btn" type="button" aria-label="Kürzel-Übersicht schließen" onClick={() => setOpen(false)}>
          ✕
        </button>
      </div>
      {openOverlays.length > 0 && (
        <>
          <div class="cheatsheet-head dim">Gerade offen</div>
          {openOverlays.map((s) => (
            <Row key={s.id} info={s} />
          ))}
        </>
      )}
      <div class="cheatsheet-head dim">Überall</div>
      {globalKm.map((s) => (
        <Row key={s.id} info={s} />
      ))}
      <div class="cheatsheet-head dim">Eingabe-Interaktion</div>
      {local.map((s) => (
        <Row key={s.id} info={s} />
      ))}
      <div class="dim cheatsheet-note">
        Belegungen von Browser und Fenstermanager stehen je Kürzel in <code>docs/tastatur-kollisionen.md</code> — z. B. wirkt Alt+1–4 im Firefox-Tab nicht (Tab-Wechsel) und Alt+Pos1 ruft dort die Startseite.
      </div>
    </Sheet>
  );
}
