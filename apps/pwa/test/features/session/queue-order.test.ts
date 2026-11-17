import { describe, expect, it } from "vitest";
import { queueOrder } from "../../../src/features/session/QueueList.tsx";
import type { QueuedPrompt } from "../../../src/shared/api.ts";

const item = (id: string, text: string, position?: number): QueuedPrompt => ({
  id,
  text,
  createdAt: "2026-11-17T08:00:00.000Z",
  actor: "handy",
  attachments: 0,
  ...(position === undefined ? {} : { position }),
});

describe("Warteschlangen-Reihe (ADR-0085)", () => {
  it("sortiert nach der gespeicherten Position", () => {
    const list = [item("c", "dritte", 2), item("a", "erste", 0), item("b", "zweite", 1)];
    expect(queueOrder(list).map((q) => q.text)).toEqual(["erste", "zweite", "dritte"]);
  });

  it("lässt die Reihenfolge in Ruhe, wenn ein älterer Hub keine Position liefert", () => {
    const list = [item("a", "zuerst eingetroffen"), item("b", "danach"), item("c", "zum Schluss")];
    expect(queueOrder(list).map((q) => q.text)).toEqual(["zuerst eingetroffen", "danach", "zum Schluss"]);
  });

  it("mischt nicht: halbe Positionen sind kein Grund, per NaN neu zu würfeln", () => {
    const list = [item("a", "ohne", undefined), item("b", "mit", 5), item("c", "ohne zwei")];
    expect(queueOrder(list).map((q) => q.text)).toEqual(["ohne", "mit", "ohne zwei"]);
  });

  it("die Ausgangsliste bleibt unverändert (keine Seiteneffekte auf den State)", () => {
    const list = [item("b", "zweite", 1), item("a", "erste", 0)];
    queueOrder(list);
    expect(list.map((q) => q.id)).toEqual(["b", "a"]);
  });
});
