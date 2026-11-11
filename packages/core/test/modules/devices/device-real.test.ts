import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { DeviceService } from "@ancientvoid/core";

/**
 * EPIC-P42 (ADR-0067): echte Geräteläufe. Läuft nur, wenn ein AV-eigener Emulator läuft:
 * env ANCIENTVOID_ANDROID_SERIAL=<serial> (z. B. emulator-5554) und optional
 * ANCIENTVOID_ANDROID_SDK=<sdk-root>. Ohne env: sichtbarer Skip — nie als Pass zählen (T42.6).
 */
const serial = process.env.ANCIENTVOID_ANDROID_SERIAL ?? "";
const sdkRoot = process.env.ANCIENTVOID_ANDROID_SDK ?? process.env.ANDROID_SDK_ROOT ?? "";
const ready = Boolean(serial) && Boolean(sdkRoot) && existsSync(join(sdkRoot, "platform-tools", "adb"));

describe.skipIf(!ready)("DeviceService gegen echten Emulator (EPIC-P42, env-ge gated)", () => {
  const svc = new DeviceService({ dataDir: `${tmpdir()}/ancientvoid-devices-real-${Date.now()}`, sdkRoot });

  it("capabilities sind bereit (SDK + KVM vorhanden)", () => {
    const caps = svc.capabilities();
    expect(caps.ready, caps.reasons.join(" ")).toBe(true);
  });

  it("frame liefert ein PNG mit Geometrie aus dem Bild selbst", async () => {
    const frame = await svc.frame(serial);
    expect(frame).not.toBeNull();
    expect(frame!.width).toBeGreaterThan(0);
    expect(frame!.height).toBeGreaterThan(0);
    expect(frame!.data.subarray(1, 4).toString()).toBe("PNG");
  }, 30_000);

  it("logs sind begrenzt und liefern Text", async () => {
    const logs = await svc.logs(serial, 4096);
    expect(logs.text.length).toBeGreaterThan(0);
    expect(logs.text.length).toBeLessThanOrEqual(4096);
  }, 30_000);

  it("accessibility tree ist XML", async () => {
    const tree = await svc.tree(serial);
    expect(tree.xml).toContain("<hierarchy");
  }, 60_000);
});
