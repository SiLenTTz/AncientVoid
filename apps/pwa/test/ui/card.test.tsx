import { describe, expect, it } from "vitest";
import { Card } from "../../src/shared/ui/Card.tsx";

const props = (node: unknown) => (node as { props: Record<string, unknown> }).props;

describe("Card (EPIC-P63 T63.7)", () => {
  it("Standard: Fläche mit Innenabstand", () => {
    expect(props(Card({ children: "Inhalt" }))!.class).toBe("ui-card");
  });

  it("padding none und elevated sind Modifikatoren", () => {
    expect(props(Card({ padding: "none", children: "x" }))!.class).toContain("ui-card--flush");
    expect(props(Card({ elevated: true, children: "x" }))!.class).toContain("ui-card--elevated");
  });

  it("Datenattribute reichen durch (Testanker)", () => {
    expect(props(Card({ "data-testid": "queue", children: "x" }))!["data-testid"]).toBe("queue");
  });
});
