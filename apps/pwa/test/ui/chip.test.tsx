import { describe, expect, it } from "vitest";
import { Chip, ChipStatic } from "../../src/shared/ui/Chip.tsx";

const props = (node: unknown) => (node as { props: Record<string, unknown> }).props;

function childrenOf(node: unknown) {
  return ((node as { props: { children: unknown[] } }).props.children ?? []) as { props: Record<string, unknown>; type?: unknown }[];
}

describe("Chip (EPIC-P63 T63.7)", () => {
  it.each(["ok", "warn", "err", "info", "neutral"] as const)("Ton %s wird zur Klasse", (tone) => {
    expect(props(Chip({ tone, children: "x" }))!.class).toContain(`ui-chip--${tone}`);
  });

  it("active trägt Klasse und aria-pressed", () => {
    const p = props(Chip({ active: true, children: "x" }));
    expect(p.class).toContain("active");
    expect(p["aria-pressed"]).toBe(true);
  });

  it("onRemove erzeugt eine bedienbare ✕-Taste mit Label (Tastatur: Enter/Leerzeichen)", () => {
    let removed = 0;
    const kids = childrenOf(Chip({ onRemove: () => (removed += 1), removeLabel: "Filter entfernen", children: "x" }));
    const remove = kids.find((k) => (k.props?.class as string)?.includes("ui-chip-remove"))!;
    expect(remove.props["aria-label"]).toBe("Filter entfernen");
    (remove.props.onKeyDown as (e: { key: string; preventDefault: () => void; stopPropagation: () => void }) => void)({ key: "Enter", preventDefault: () => {}, stopPropagation: () => {} });
    expect(removed).toBe(1);
  });

  it("ChipStatic ist keine Taste (span)", () => {
    const p = props(ChipStatic({ children: "3 Projekte" }));
    expect(p.class).toContain("ui-chip--static");
  });
});
