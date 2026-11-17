import { describe, expect, it } from "vitest";

import { ClientReportBody } from "@ancientvoid/contracts";

import { orientationReportBody, type ReportHow } from "../../src/shared/device-report.ts";
import type { DeviceStatus } from "../../src/shared/device-status.ts";

/** BUG-0186: der Selbstbericht muss dem Vertrag standhalten, sonst lehnt der Hub ihn ab. */
describe("Geräte-Selbstbericht (BUG-0186)", () => {
  const stand: DeviceStatus = {
    displayMode: "installiert (eigenes Fenster)",
    windowOrientation: "portrait-primary",
    windowAngle: 0,
    landscape: false,
    manifestOrientation: "any",
    manifestCaches: [],
    swCache: "ancientvoid-v6",
  };

  it("bildet Anzeigemodus und Winkel so ab, dass der Hub sie versteht", () => {
    const body = orientationReportBody(stand, "abgewiesen", "NotSupportedError — Gerät hält die Ausrichtung fest.");
    expect(body.kind).toBe("orientation");
    expect(body.angle).toBe(0);
    expect(body.how).toBe("abgewiesen");
    expect(body.displayMode).toBe("standalone");
    expect(body.manifestOrientation).toBe("any");
    const parsed = ClientReportBody.safeParse(body);
    expect(parsed.success).toBe(true);
  });

  it("meldet einen Browser-Tab als Browser, nicht als installiert", () => {
    const body = orientationReportBody({ ...stand, displayMode: "Browser-Tab", windowAngle: 90 }, "gelockt", "quer erzwungen");
    expect(body.displayMode).toBe("browser");
    expect(body.angle).toBe(90);
    expect(ClientReportBody.safeParse(body).success).toBe(true);
  });

  it("kurzt einen langen Text auf die Vertragsgrenze, statt ihn abzurutschen", () => {
    const body = orientationReportBody(stand, "keine-api" as ReportHow, "x".repeat(400));
    expect(body.detail.length).toBeLessThanOrEqual(200);
    expect(ClientReportBody.safeParse(body).success).toBe(true);
  });

  it("ohne Winkel-Api luegt der Bericht nicht, sondern meldet 0 als Messwert", () => {
    const body = orientationReportBody({ ...stand, windowAngle: null }, "nicht-versucht", "Stand neu geprueft");
    expect(typeof body.angle).toBe("number");
    expect(ClientReportBody.safeParse(body).success).toBe(true);
  });
});
