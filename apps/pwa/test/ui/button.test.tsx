import { describe, expect, it } from "vitest";
import { Button } from "../../src/shared/ui/Button.tsx";

/** EPIC-P63 T63.7: Knopf-Baustein — Varianten, Größen, Tastatur/ARIA-Attribute.
 * Geprüft wird die VDOM-Ebene (die visuelle Parität zu .btn deckt die
 * css-tokens-Ratchets und E2E ab); Events werden direkt aufgerufen. */
const props = (node: ReturnType<typeof Button>) => node.props as Record<string, unknown> & { class?: string; classList?: never };

describe("Button", () => {
  it("ohne Variante ist die ruhige Fläche (subtle) mit Typ button", () => {
    const p = props(Button({ children: "Los" })!);
    expect(p.class).toBe("ui-button");
    expect(p.type).toBe("button");
  });

  it.each(["primary", "danger", "link", "subtle"] as const)("Variante %s wird zur Klasse und aria bleibt durchlässig", (variant) => {
    const p = props(Button({ variant, "aria-label": "Label", children: "x" })!);
    expect(p.class).toContain(`ui-button--${variant}`);
    expect(p["aria-label"]).toBe("Label");
  });

  it("size sm und icon setzen die Modifikatoren", () => {
    expect(props(Button({ size: "sm", children: "x" })!)!.class).toContain("ui-button--sm");
    const icon = props(Button({ icon: true, title: "Herauslösen", children: "⧉" })!);
    expect(icon.class).toContain("ui-button--icon");
    expect(icon.title).toBe("Herauslösen");
  });

  it("deaktiviert und Klick laufen durch (Tastatur: native button-Semantik)", () => {
    let hits = 0;
    const p = props(Button({ disabled: true, onClick: () => (hits += 1), children: "x" })!);
    expect(p.disabled).toBe(true);
    (p.onClick as () => void)();
    expect(hits).toBe(1);
  });

  it("eigene Klasse wird angehängt, nicht ersetzt", () => {
    expect(props(Button({ class: "busy", children: "x" })!)!.class).toBe("ui-button busy");
  });
});
