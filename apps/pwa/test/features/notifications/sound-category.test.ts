import { describe, expect, it } from "vitest";
import { soundCategoryOf } from "../../../src/features/notifications/sound-category.ts";

/** EPIC-P65 T65.2: Kategorie-Mapping (gleiche Taxonomie wie der P64-Glow).
 * approval-Kandidaten laufen über die Pending-Bestätigung in der Komponente
 * und werden hier bewusst nicht gemappt. */
describe("soundCategoryOf — Mapping neuer Meldungen (EPIC-P65)", () => {
  it("Fehler → error", () => {
    expect(soundCategoryOf({ level: "error", kind: "provider.error", pending: false })).toBe("error");
  });

  it("Lauf beendet → done (Toast-Unterdrückung T8.6 ändert nichts am Sound)", () => {
    expect(soundCategoryOf({ level: "success", kind: "session.turn_end", pending: false })).toBe("done");
  });

  it("Freigabe/Frage mit bestätigtem Pending → action", () => {
    expect(soundCategoryOf({ level: "info", kind: "tool.permission_requested", pending: true })).toBe("action");
    expect(soundCategoryOf({ level: "warning", kind: "session.steer_pending_approval", pending: true })).toBe("action");
  });

  it("Übriges ohne Pending → info (beantwortete Frage zählt zum Rest)", () => {
    expect(soundCategoryOf({ level: "info", kind: "session.info", pending: false })).toBe("info");
    expect(soundCategoryOf({ level: "warning", kind: "hub.unreachable", pending: false })).toBe("info");
    expect(soundCategoryOf({ level: "success", kind: "hub.reachable", pending: false })).toBe("info");
    expect(soundCategoryOf({ level: "info", kind: "tool.permission_requested", pending: false })).toBe("info");
  });

  it("error schlägt die Frage-Priorität (wie beim Glow)", () => {
    expect(soundCategoryOf({ level: "error", kind: "tool.permission_requested", pending: true })).toBe("error");
  });
});

describe("EPIC-P67 T67.6 — Main-Sync-Meldungen", () => {
  it("Rückfrage und Konflikt klingen wie eine Frage (action), Erfolg bleibt info", () => {
    expect(soundCategoryOf({ level: "warning", kind: "mainsync.behind_ask", pending: false })).toBe("action");
    expect(soundCategoryOf({ level: "warning", kind: "mainsync.conflict", pending: false })).toBe("action");
    expect(soundCategoryOf({ level: "success", kind: "mainsync.applied", pending: false })).toBe("info");
    expect(soundCategoryOf({ level: "warning", kind: "mainsync.behind", pending: false })).toBe("info");
    expect(soundCategoryOf({ level: "error", kind: "mainsync.failed", pending: false })).toBe("error");
  });
});
