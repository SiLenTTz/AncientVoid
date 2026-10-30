import { describe, expect, it } from "vitest";
import { createAdapter } from "../src/index.ts";

/** ADR-0042/P25: maki-Commands hängen an der Host-seitigen init.lua-Brücke —
 * deklariert wird nur mit bridgeCommands:true, sonst bleibt die Liste leer. */
describe("acp capabilities().commands — maki-Brücke (bridgeCommands)", () => {
  it("ohne Flag: maki deklariert nichts (fail loud für Hosts ohne Brücke)", () => {
    const caps = createAdapter({ preset: "maki" }).capabilities();
    expect(caps.commands).toBeUndefined();
  });

  it("mit Flag: genau die Brücken-Commands, wohlgeformt", () => {
    const caps = createAdapter({ preset: "maki", bridgeCommands: true }).capabilities();
    const names = (caps.commands ?? []).map((c) => c.name);
    // BUG-0079: deklariert ist nur, was der Adapter belegt ausführt —
    // /compact und /rename haben im getriebenen Modus keinen Beleg.
    expect(names).toEqual(["/new"]);
    for (const c of caps.commands ?? []) {
      expect(c.scope).toBe("both");
      expect(c.description.length).toBeGreaterThan(3);
    }
  });

  it("andere Presets bleiben unberührt (copilot ja, opencode nein)", () => {
    expect(createAdapter({ preset: "copilot" }).capabilities().commands?.map((c) => c.name)).toEqual(["/compact", "/usage"]);
    expect(createAdapter({ preset: "opencode" }).capabilities().commands).toBeUndefined();
    expect(createAdapter({ preset: "maki", bridgeCommands: false }).capabilities().commands).toBeUndefined();
  });
});
