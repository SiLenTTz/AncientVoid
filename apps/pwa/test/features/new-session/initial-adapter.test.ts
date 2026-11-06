import { describe, expect, it } from "vitest";
import { initialAdapter } from "../../../src/features/new-session/CreateSession.tsx";

describe("initialAdapter (BUG-0096)", () => {
  it("behält die Merkung, wenn die Adapterliste beim Mount noch leer ist", () => {
    // Der CI-Fall: Liste lädt async — der alte Fallback stellte hier „dummy“
    // dauerhaft ein, weil der Nachlade-Effekt einen gültig erscheinenden
    // Wert nie korrigierte (Lauf 3034417565, drafts.spec).
    expect(initialAdapter({ adapter: "opencode" }, [])).toBe("opencode");
  });

  it("fällt ohne Merkung auf den ersten Adapter und sonst auf dummy", () => {
    expect(initialAdapter(undefined, [{ id: "dummy" }, { id: "opencode" }])).toBe("dummy");
    expect(initialAdapter({}, [])).toBe("dummy");
  });
});
