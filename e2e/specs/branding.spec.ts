import { test, expect } from "../support/fixtures.ts";

/**
 * ADR-0046: Das Produkt heißt AncientVoid. Titel, Manifest (inkl. maskable
 * Icons), Favicon und Logo müssen erreichbar sein — ein 404 beim Icon
 * würde die Installierbarkeit der PWA still kaputt machen.
 */
interface Manifest {
  name: string;
  short_name: string;
  icons: { src: string; sizes: string; type: string; purpose?: string }[];
}

test.describe("Branding (ADR-0046)", () => {
  test("Manifest nennt AncientVoid und liefert any- und maskable-Icons", async ({ app, hub }) => {
    const res = await app.request.get(`${hub.origin}/manifest.webmanifest`);
    expect(res.ok()).toBeTruthy();
    const manifest = (await res.json()) as Manifest;
    expect(manifest.name).toBe("AncientVoid");
    expect(manifest.short_name).toBe("AncientVoid");
    const purposes = manifest.icons.map((i) => i.purpose);
    expect(purposes).toContain("any");
    expect(purposes).toContain("maskable");
    for (const size of ["192x192", "512x512"]) {
      expect(manifest.icons.some((i) => i.sizes === size && i.purpose === "maskable")).toBe(true);
      expect(manifest.icons.some((i) => i.sizes === size && i.purpose === "any")).toBe(true);
    }
    for (const icon of manifest.icons) {
      const img = await app.request.get(`${hub.origin}${icon.src}`);
      expect(img.ok(), icon.src).toBeTruthy();
      expect(img.headers()["content-type"]).toContain("image/png");
    }
  });

  test("Titel, Favicon und Header-Logo zeigen AncientVoid", async ({ app, hub }) => {
    await expect(app).toHaveTitle("AncientVoid");
    const favicon = await app.locator('link[rel="icon"]').getAttribute("href");
    expect(favicon).toBeTruthy();
    expect((await app.request.get(`${hub.origin}${favicon}`)).ok()).toBeTruthy();
    const apple = await app.locator('link[rel="apple-touch-icon"]').getAttribute("href");
    expect((await app.request.get(`${hub.origin}${apple}`)).ok()).toBeTruthy();
    const brand = app.getByRole("button", { name: "AncientVoid", exact: true });
    await expect(brand).toBeVisible();
    const logo = brand.locator("img.brand-logo");
    await expect(logo).toBeVisible();
    expect(await logo.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
  });
});
