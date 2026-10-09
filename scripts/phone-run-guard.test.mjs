import { describe, expect, it } from "vitest";
import { abortReason, quarterFromDumpsys } from "./phone-run-guard.mjs";

describe("phone-run-guard", () => {
  it("liest ROTATION_90 aus dumpsys, nicht nur eine nackte Ziffer", () => {
    const landscape = "mDisplayRotation=ROTATION_90 mRotation=ROTATION_90";
    const portrait = "mDisplayRotation=ROTATION_0 mRotation=ROTATION_0";
    expect(quarterFromDumpsys(landscape)).toBe("1");
    expect(quarterFromDumpsys(portrait)).toBe("0");
    expect(quarterFromDumpsys("mRotation=3")).toBe("3");
  });

  it("beendet den Lauf, wenn die DevTools-Verbindung weg ist oder das Hochformat verlassen wurde", () => {
    expect(abortReason({ quarter: "0", cdpDown: true, lockPortrait: true })).toMatch(/DevTools/);
    expect(abortReason({ quarter: "1", cdpDown: false, lockPortrait: true })).toMatch(/Querformat/);
    expect(abortReason({ quarter: "0", cdpDown: false, lockPortrait: true })).toBeNull();
    expect(abortReason({ quarter: "1", cdpDown: false, lockPortrait: false })).toBeNull();
  });
});
