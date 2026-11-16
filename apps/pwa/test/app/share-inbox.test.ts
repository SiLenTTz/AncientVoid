import { describe, expect, it, vi } from "vitest";
import { captureShareTarget, storeShareInbox, takeShareInbox } from "../../src/app/share-inbox.ts";

describe("Share Target (AI-P9-2)", () => {
  it("baut Titel, Text und URL zu einem Prompt zusammen", () => {
    expect(captureShareTarget("?title=Hinweis&text=Schau%20dir%20das%20an&url=https://example.com/x")).toEqual({
      text: "Hinweis\n\nSchau dir das an\n\nhttps://example.com/x",
    });
  });

  it("ein nackter Link steht nur einmal (Browser setzen text und url identisch)", () => {
    const link = "https://example.com/only";
    expect(captureShareTarget(`?text=${encodeURIComponent(link)}&url=${encodeURIComponent(link)}`)).toEqual({ text: link });
  });

  it("ohne jeden Parameter ist es kein Share", () => {
    expect(captureShareTarget("")).toBeNull();
    expect(captureShareTarget("?")).toBeNull();
    expect(captureShareTarget("?title=&text=&url=")).toBeNull();
  });

  it("Inbox ist Einmal-Speicher: take liefert und löscht", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
    storeShareInbox("Von woanders");
    expect(takeShareInbox()).toBe("Von woanders");
    expect(takeShareInbox()).toBeNull();
    vi.unstubAllGlobals();
  });
});
