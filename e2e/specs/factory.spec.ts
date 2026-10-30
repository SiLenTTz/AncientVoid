import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "../support/fixtures.ts";

/**
 * EPIC-P26 T26.5 / ADR-0043: ein Factory-Lauf über den Hub startet zwei
 * verknüpfte Sessions — Treiber (Claude, erster Prompt `/factory` mit dem
 * Auftrag) und Beobachter (Loop securesight-factory, Modus project). Die
 * Factory ist damit wie jede andere Session auswählbar und monitorbar.
 */
test.describe("Factory-Lauf über den Hub (T26.5, ADR-0043)", () => {
  test("Start im Dialog legt Treiber mit /factory-Auftrag und verknüpften Beobachter an", async ({ app, hub }) => {
    // Ein Factory-Projekt im Modus `project`: .factory/config.json, kein betrieb.py.
    const project = join(hub.projectsDir, "factory-demo");
    mkdirSync(join(project, ".factory"), { recursive: true });
    writeFileSync(join(project, ".factory", "config.json"), "{}\n");
    // Wie nach echtem `factory init`: ein Intake-Zustand, den der Beobachter melden kann.
    mkdirSync(join(project, ".factory", "intake"), { recursive: true });
    writeFileSync(join(project, ".factory", "intake", "state.json"), JSON.stringify({ schema_version: "1", status: "intake", execution_ready: false, next_action: "erste Aufgabe festlegen" }));
    execSync("git init -q", { cwd: project }); // nur so taucht das Projekt in der Auswahl auf (Tiefe 1, .git)

    await app.getByRole("button", { name: "Neue Session" }).click();
    await app.locator(".form-grid > label").first().locator("select").selectOption(project);
    await app.getByLabel("Loop", { exact: true }).selectOption("securesight-factory");
    await app.getByPlaceholder("Refactore den Auth-Flow…").fill("AncientVoid-Rename vorbereiten");
    await app.getByRole("button", { name: "Starten" }).click();

    // Der Dialog öffnet den Beobachter — der Lauf ist eine ganz normale Session.
    await expect(app).toHaveURL(/#\/(hosts\/[^/]+\/)?sessions\//);
    const observerId = decodeURIComponent(app.url().match(/sessions\/([^/?]+)/)![1]!);
    const observer = (await hub.api<{ adapter: string; project: string }>(`/api/sessions/${observerId}`)).body;
    expect(observer.adapter).toBe("loop:securesight-factory");
    expect(observer.project).toBe(project);

    // Der Treiber trägt den Auftrag als /factory-Prompt und ist mit dem
    // Beobachter verknüpft (factory.linkage auf beiden Sessions).
    const sessions = (await hub.api<{ id: string; adapter: string }[]>("/api/sessions")).body;
    const driver = sessions.find((s) => s.adapter === "claude" && s.id !== observerId);
    expect(driver).toBeDefined();
    const driverEvents = await hub.events(driver!.id);
    expect(driverEvents.some((e) => e.type === "user" && String((e.payload as { text?: string }).text ?? "").startsWith("/factory AncientVoid-Rename vorbereiten"))).toBe(true);
    const linkOf = (events: Awaited<ReturnType<typeof hub.events>>) => events.find((e) => (e.payload as { kind?: string }).kind === "factory.linkage");
    expect((linkOf(driverEvents)?.payload as { factory?: { partner?: string } }).factory?.partner).toBe(observerId);
    expect((linkOf(await hub.events(observerId))?.payload as { factory?: { partner?: string } }).factory?.partner).toBe(driver!.id);

    // Der Beobachter meldet sich aus dem Projekt (Intake sichtbar, kein Stillstand).
    await hub.until(async () => (await hub.events(observerId)).some((e) => (e.payload as { kind?: string }).kind === "loop.info" || (e.payload as { kind?: string }).kind === "loop.broken"), "Beobachter meldet sich", 20_000);
  });
});
