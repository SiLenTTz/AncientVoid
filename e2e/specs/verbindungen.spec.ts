import { test, expect, dockGo } from "../support/fixtures.ts";
import type { Locator, Page } from "@playwright/test";
import { createServer } from "node:net";

/**
 * Verbindungs-Registry in den Optionen: VoidWarden-Instanzen mit einmalig
 * sichtbarem read-only-Token (Status = letzte Meldung am Hub) und generische
 * Modell-/Tool-Endpoints mit write-only-Schlüssel und Erreichbarkeits-Check.
 * Der erreichbare Endpoint ist der Hub selbst (/api/health), der tote ein
 * garantiert freier Port — kein Cloud-Egress.
 */

async function closedPort(): Promise<number> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.listen(0, "127.0.0.1", () => {
      const port = (probe.address() as { port: number }).port;
      probe.close(() => resolve(port));
    });
  });
}

async function openSettings(app: Page): Promise<Locator> {
  await dockGo(app, "Einstellungen");
  const section = app.locator(".connections-settings");
  await expect(section).toBeVisible();
  return section;
}

test.describe("Verbindungen (Optionen)", () => {
  test("VoidWarden anlegen: Token einmalig sichtbar und lesend nutzbar, Status wird zur Meldung, alles überlebt den Reload", async ({ app, hub }) => {
    const section = await openSettings(app);
    const vw = section.getByRole("group", { name: "VoidWarden-Instanzen" });

    await vw.getByLabel("Name", { exact: true }).fill("Nyx Board");
    await vw.getByLabel(/Endpunkt \(optional\)/).fill("http://pixel:8080");
    await vw.getByRole("button", { name: "Verbindung anlegen" }).click();

    // Das Token erscheint genau einmal und trägt die Zeichen eines echten Bearer-Tokens.
    await expect(vw.locator(".connection-token")).toBeVisible();
    const token = (await vw.locator(".connection-token-value").innerText()).trim();
    expect(token.length).toBeGreaterThan(20);
    const entry = vw.locator(".connection-entry", { hasText: "Nyx Board" });
    await expect(entry).toBeVisible();
    await expect(entry.getByText("noch nie gemeldet")).toBeVisible();

    // Mit dem Token liest VoidWarden den Hub (read-only, agent:-Policy).
    const read = await hub.apiRaw("/api/sessions", { token });
    expect(read.status).toBe(200);

    // Nach dem Neuladen: Eintrag da, Token weg, Status zeigt die Meldung.
    await app.reload();
    const sectionAfter = await openSettings(app);
    const vwAfter = sectionAfter.getByRole("group", { name: "VoidWarden-Instanzen" });
    const entryAfter = vwAfter.locator(".connection-entry", { hasText: "Nyx Board" });
    await expect(entryAfter).toBeVisible();
    await expect(entryAfter.getByText(/gemeldet (gerade eben|vor )/)).toBeVisible();
    await expect(vwAfter.locator(".connection-token")).toHaveCount(0);
  });

  test("Endpoint anlegen: Schlüssel bleibt unsichtbar, Prüfen zeigt Erreichbarkeit, Löschen räumt auf", async ({ app, hub }) => {
    const section = await openSettings(app);
    const ep = section.getByRole("group", { name: "Modell- und Tool-Endpoints" });

    await ep.getByLabel("Name", { exact: true }).fill("Gpubox");
    await ep.getByLabel("Typ").selectOption("llm");
    await ep.getByLabel("Endpunkt-URL", { exact: true }).fill(`${hub.origin}/api/health`);
    await ep.getByLabel(/API-Key/).fill("sk-e2e-streng-geheim-42");
    await ep.getByLabel(/Aktivierte Modelle/).fill("halogen-qwen, halogen-vision");
    await ep.getByRole("button", { name: "Endpoint anlegen" }).click();

    const live = ep.locator(".connection-entry", { hasText: "Gpubox" });
    await expect(live.getByText("LLM")).toBeVisible();
    await expect(live.getByText("Schlüssel hinterlegt ✓")).toBeVisible();
    await expect(live.getByText("halogen-qwen, halogen-vision")).toBeVisible();
    await expect(live.getByText("nie geprüft")).toBeVisible();
    // Vom Schlüssel steht nirgends im Dokument der Klartext — nur der Hub kennt den Hash.
    await expect(app.locator("body")).not.toContainText("sk-e2e-streng-geheim-42");

    await live.getByRole("button", { name: "Prüfen" }).click();
    await expect(live.getByText(/erreichbar \(HTTP 200\)/)).toBeVisible();

    // Ein toter Endpoint (freigegebener Port) wird ehrlich nicht erreichbar gemeldet.
    await ep.getByLabel("Name", { exact: true }).fill("Toter Endpunkt");
    await ep.getByLabel("Typ").selectOption("image");
    await ep.getByLabel("Endpunkt-URL", { exact: true }).fill(`http://127.0.0.1:${await closedPort()}/v1`);
    await ep.getByLabel(/API-Key/).fill("");
    await ep.getByLabel(/Aktivierte Modelle/).fill("");
    await ep.getByRole("button", { name: "Endpoint anlegen" }).click();
    const dead = ep.locator(".connection-entry", { hasText: "Toter Endpunkt" });
    await dead.getByRole("button", { name: "Prüfen" }).click();
    await expect(dead.getByText("nicht erreichbar")).toBeVisible();

    // Löschen nimmt den Eintrag raus — auch nach Reload bleibt er weg.
    await dead.getByRole("button", { name: "Toter Endpunkt löschen" }).click();
    await expect(ep.locator(".connection-entry", { hasText: "Toter Endpunkt" })).toHaveCount(0);
    await app.reload();
    const sectionAfter = await openSettings(app);
    await expect(sectionAfter.getByRole("group", { name: "Modell- und Tool-Endpoints" }).locator(".connection-entry", { hasText: "Toter Endpunkt" })).toHaveCount(0);
    await expect(sectionAfter.getByRole("group", { name: "Modell- und Tool-Endpoints" }).locator(".connection-entry", { hasText: "Gpubox" })).toBeVisible();
  });
});
