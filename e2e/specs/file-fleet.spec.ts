import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "../support/fixtures.ts";
import { TestHub } from "../support/hub.ts";

/** EPIC-P46 (ADR-0058 §10): Projekte und Dateien einer anderen Maschine über die Flotte — nur Lesen. */
test.describe("Dateien anderer Maschinen (EPIC-P46)", () => {
  test.use({ hubOptions: { hostId: "omarchy", label: "e2e-home-label" } });

  test("Projekt des Peers ist wählbar, Datei lesbar; Diagnose wird dort nicht angeboten @desktop", async ({ app }) => {
    const peer = await TestHub.start({ hostId: "silenttz-server", label: "silenttz-server" });
    try {
      writeFileSync(join(peer.alpha, "fern.txt"), "Inhalt von der anderen Maschine\n");
      await app.locator(".dock").getByRole("button", { name: "Einstellungen" }).click();
      const invite = await peer.api<{ code: string }>("/api/fleet/invites", { body: {} });
      await app.getByLabel("Host hinzufügen — Adresse").fill(peer.origin);
      await app.getByLabel("Einladungscode vom anderen Hub").fill(invite.body.code.toLowerCase());
      await app.getByRole("button", { name: "Host verbinden" }).click();
      await expect(app.locator(".fleet-message.ok")).toHaveText("Verbunden mit silenttz-server.");

      await app.locator(".dock").getByRole("button", { name: "Übersicht" }).click().catch(() => undefined);
      await app.getByRole("button", { name: "Dateibaum öffnen" }).click();
      const source = app.getByLabel("Dateiquelle");
      await expect(source.locator("option", { hasText: "(silenttz-server)" }).first()).toBeAttached({ timeout: 20_000 });
      const value = await source.locator("option", { hasText: "(silenttz-server)" }).first().getAttribute("value");
      await source.selectOption(value!);
      await app.getByTestId("files-sidebar").locator('[data-path="fern.txt"]').click();
      await expect(app.getByTestId("file-text")).toContainText("Inhalt von der anderen Maschine");
      await expect(app.getByRole("group", { name: "Ansicht" }).getByRole("button", { name: "Diagnose" })).toHaveCount(0);
    } finally {
      await peer.stop();
    }
  });
});
