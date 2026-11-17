/**
 * EPIC-P63 AC-P63-8 — Probe-Screen nach dem Rezept in docs/design-system.md.
 * Nicht geroutet (liegt unter e2e/fixtures/, ausgeschlossen aus Root-tsc).
 * Belegt Bausteine + Tokens ohne Allowlist — Prüfung: apps/pwa/test/ds-probe.test.ts.
 *
 * Absichtlich als h()-Baum (kein JSX), damit der Fixture-Ordner ohne PWA-jsx
 * lesbar bleibt, falls jemand ihn doch typt.
 */
import { h } from "preact";
import { useState } from "preact/hooks";
// Import-Pfad wie im Rezept: Bausteine aus shared/ui (nicht geroutet, nur Beleg).
import { Button, Card, Chip, EmptyState, Sheet } from "../../../apps/pwa/src/shared/ui/index.ts";

export function DsProbe() {
  const [open, setOpen] = useState(false);
  return h(
    "div",
    { class: "ds-probe", "data-testid": "ds-probe" },
    h(
      Card,
      { elevated: true },
      h("h1", { class: "ds-probe-title" }, "Design-System-Probe"),
      h("p", { class: "ds-probe-copy" }, "Bausteine ohne rohe btn/chip/card/empty-Klassen."),
      h(
        "div",
        { class: "ds-probe-row" },
        h(Chip, { tone: "info", active: true }, "Probe"),
        h(Button, { variant: "primary", onClick: () => setOpen(true) }, "Blatt öffnen"),
      ),
      h(EmptyState, {
        icon: "◇",
        text: "Hier wäre Inhalt — die Probe bleibt absichtlich leer.",
        action: h(Button, { variant: "subtle", size: "sm", onClick: () => setOpen(true) }, "Aktion"),
      }),
    ),
    h(
      Sheet,
      { open, onClose: () => setOpen(false), label: "Probe-Blatt", testid: "ds-probe-sheet" },
      h("p", { class: "ds-probe-copy" }, "Sheet mit Fokusfalle und Esc."),
      h(Button, { variant: "primary", onClick: () => setOpen(false) }, "Schließen"),
    ),
  );
}
