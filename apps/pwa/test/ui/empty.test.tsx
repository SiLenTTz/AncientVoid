import { describe, expect, it } from "vitest";
import { EmptyState } from "../../src/shared/ui/EmptyState.tsx";
import { Button } from "../../src/shared/ui/Button.tsx";

const props = (node: unknown) => (node as { props: Record<string, unknown> }).props;

describe("EmptyState (EPIC-P63 T63.7, Kleinkram-Regel 2)", () => {
  it("sagt in einem Satz was fehlt (role=status) und bietet die Aktion an", () => {
    const action = Button({ variant: "link", children: "Zum Chat" })!;
    const p = props(EmptyState({ text: "Diese Session hat noch nichts geändert.", action }));
    expect(p.role).toBe("status");
    const kids = (p.children as ({ props: Record<string, unknown>; type?: unknown } | null)[]).filter((k): k is { props: Record<string, unknown>; type?: unknown } => !!k);
    expect(kids.find((k) => (k.props?.class as string)?.includes("ui-empty-text"))).toBeTruthy();
    expect(kids.find((k) => (k.props?.class as string)?.includes("ui-empty-action"))).toBeTruthy();
  });

  it("Icon ist dekorativ (aria-hidden), Text bleibt der Inhalt", () => {
    const p = props(EmptyState({ icon: "∅", text: "Nichts hier" }));
    const kids = (p.children as ({ props: Record<string, unknown> } | null)[]).filter((k): k is { props: Record<string, unknown> } => !!k);
    const icon = kids.find((k) => (k.props?.class as string)?.includes("ui-empty-icon"))!;
    expect(icon.props["aria-hidden"]).toBe("true");
  });
});
