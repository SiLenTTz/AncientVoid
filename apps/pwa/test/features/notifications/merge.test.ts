import { describe, expect, it } from "vitest";
import { applyNotificationPage, type FleetNotification } from "../../../src/features/notifications/merge.ts";

/** BUG-0222: überlappende Polls dürfen nichts nachspielen — kein Doppel in
 * Liste und Toast. `key` = `<host>#<id>`, `known` = Cursor des Hosts. */
const n = (id: number, over: Partial<FleetNotification> = {}): FleetNotification => ({
  id,
  sessionId: null,
  level: "info",
  title: `Meldung ${id}`,
  detail: null,
  kind: "session.turn_end",
  createdAt: new Date(Date.UTC(2026, 10, 19, 12, 0, id)).toISOString(),
  action: null,
  hostId: null,
  key: `#${id}`,
  ...over,
});

describe("applyNotificationPage (BUG-0222)", () => {
  it("dieselbe Seite zweimal: keine doppelte Zeile, kein zweiter Toast-Zugang", () => {
    const page = [n(2), n(1)];
    const first = applyNotificationPage([], page, 0);
    const second = applyNotificationPage(first.next, page, first.next.reduce((m, x) => Math.max(m, x.id), 0));
    expect(second.added).toEqual([]);
    expect(second.next.map((x) => x.key)).toEqual(["#2", "#1"]);
  });

  it("späte Antwort eines älteren Polls spielt bereits Gesehenes nicht nach", () => {
    const prev = [n(5), n(4)];
    const late = [n(4), n(3)]; // beides <= known=5
    const out = applyNotificationPage(prev, late, 5);
    expect(out.added).toEqual([]);
    expect(out.next.map((x) => x.key)).toEqual(["#5", "#4"]);
  });

  it("erste Ladung füllt still — kein Toast-Zugang", () => {
    const out = applyNotificationPage([], [n(1), n(2)], null);
    expect(out.added).toEqual([]);
    expect(out.next.map((x) => x.key)).toEqual(["#2", "#1"]);
  });

  it("neue Meldungen kommen hinzu, gemischt mit bereits vorhandenen", () => {
    const out = applyNotificationPage([n(3)], [n(5), n(4)], 3);
    expect(out.added.map((x) => x.id)).toEqual([5, 4]);
    expect(out.next.map((x) => x.key)).toEqual(["#5", "#4", "#3"]);
  });

  it("Fleet-Hosts bleiben getrennte Schlüsselräume", () => {
    const peer = n(8, { hostId: "phone", key: "phone#8" });
    const out = applyNotificationPage([n(7)], [peer], 7);
    expect(out.added.map((x) => x.key)).toEqual(["phone#8"]);
    expect(out.next.map((x) => x.key)).toEqual(["phone#8", "#7"]);
  });

  it("Bestand bleibt auf 100 gekappt", () => {
    const many = Array.from({ length: 120 }, (_, i) => n(i + 1));
    const out = applyNotificationPage([], many, null);
    expect(out.next).toHaveLength(100);
    expect(out.next[0]?.key).toBe("#120");
  });
});
