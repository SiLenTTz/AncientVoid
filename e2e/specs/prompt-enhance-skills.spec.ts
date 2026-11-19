import { createServer, type Server } from "node:http";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "../support/fixtures.ts";
import { freePort } from "../support/ports.ts";

/**
 * EPIC-P68 (ADR-0089): Verbessern fragt zuerst das lokale Modell, ein
 * belegtes Modell gibt an den Adapter ab, und eine vorhandene Skill-Datei
 * wird gezeigt und angepasst statt dupliziert. Stand-in für llama.cpp:
 * `/slots` und `/v1/chat/completions`; OpenCode ist der E2E-Stand-in.
 */
const port = await freePort();
let server: Server;
let busy = false;
/** Nutzerauftrag 19.11.2026: hält die Optimierung künstlich offen, damit der
 * Spinner statt der Verbessern-Taste sichtbar geprüft werden kann. */
let slow = false;

test.beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      res.writeHead(200, { "content-type": "application/json" });
      if (req.url === "/slots") {
        res.end(JSON.stringify([{ id: 0, is_processing: busy }]));
        return;
      }
      const body = JSON.parse(Buffer.concat(chunks).toString() || "{}") as { messages?: { role: string; content: string }[] };
      const system = body.messages?.[0]?.content ?? "";
      const user = body.messages?.[1]?.content ?? "";
      let content: string;
      if (system.startsWith("You decide whether")) {
        content = /neon/i.test(user) ? JSON.stringify({ action: "update", name: "neon", reason: "Neon-Skill gibt es schon" }) : JSON.stringify({ action: "none" });
      } else if (system.startsWith("You maintain a skill")) {
        content = "---\nname: neon\ndescription: Neon-Styling für die Oberfläche\nextends: task\n---\nNutze Neonfarben.\nGlow nur auf Buttons.\n";
      } else {
        content = `Ziel: ${user} (lokal)\nScope: Projekt alpha\nConstraints: keine\nErfolgskriterium: sichtbar`;
      }
      const send = () => res.end(JSON.stringify({ choices: [{ message: { content } }] }));
      if (slow) setTimeout(send, 700);
      else send();
    });
  });
  await new Promise<void>((r) => server.listen(port, "127.0.0.1", r));
});
test.afterAll(() => server?.close());
test.afterEach(() => {
  busy = false;
  slow = false;
});

test.use({ hubOptions: { assistantUrl: `http://127.0.0.1:${port}/v1` } });

test.describe("Prompt verbessern lokal + Skill-Pflege (EPIC-P68)", () => {
  // One stand-in server with a shared busy switch.
  test.describe.configure({ mode: "serial" });

  test("Verbessern nutzt das lokale Modell und sagt es (AC-P68-1, AC-P68-8)", async ({ app }) => {
    await app.getByRole("button", { name: "Neue Session" }).click();
    await app.getByLabel("Adapter").selectOption("opencode");
    const prompt = app.getByPlaceholder("Refactore den Auth-Flow…");
    await prompt.fill("mach die login seite schneller");
    await app.getByRole("button", { name: "Verbessern" }).click();
    const preview = app.locator(".enhance-preview");
    await expect(preview).toContainText("lokal (e2e-model)");
    await expect(preview).toContainText("Ziel: mach die login seite schneller (lokal)");
    // Lokal kostet kein Kontingent — kein Dollarbetrag.
    await expect(preview).not.toContainText("$");
    // Der lokale Richter sagt „none“: keine Empfehlung für einen Einmal-Prompt.
    await expect(app.locator(".recommend-card")).toHaveCount(0);
  });

  test("ein belegtes lokales Modell gibt an den Adapter ab, der Grund steht da (AC-P68-2)", async ({ app }) => {
    busy = true;
    await app.getByRole("button", { name: "Neue Session" }).click();
    await app.getByLabel("Adapter").selectOption("opencode");
    await app.getByPlaceholder("Refactore den Auth-Flow…").fill("mach die login seite schneller");
    await app.getByRole("button", { name: "Verbessern" }).click();
    const preview = app.locator(".enhance-preview");
    await expect(preview).toContainText("über opencode");
    await expect(preview.locator(".enhance-skipped")).toContainText("Lokales Modell (e2e-model): ausgelastet");
    await expect(preview).toContainText("Ziel: mach die login seite schneller\nScope: nur das genannte Projekt");
  });

  test("ein vorhandener Skill wird gezeigt, angepasst und gespeichert statt neu angelegt (AC-P68-4/5/6/8)", async ({ app, hub }) => {
    await app.getByRole("button", { name: "Neue Session" }).click();
    await app.getByLabel("Adapter").selectOption("opencode");
    await app.getByPlaceholder("Refactore den Auth-Flow…").fill("Lege einen Skill für Neon-Glow an");
    await app.getByRole("button", { name: "Verbessern" }).click();
    const card = app.locator(".recommend-card");
    await expect(card).toContainText("Vorhanden · Skill anpassen");
    await expect(card.locator("strong")).toHaveText("neon");
    await expect(card.locator(".recommend-content")).toContainText("Nutze Neonfarben.");

    await card.getByRole("button", { name: "Anpassen" }).click();
    const editor = card.getByLabel("Datei bearbeiten");
    await expect(editor).toHaveValue(/Nutze Neonfarben\./);
    await card.getByRole("button", { name: "Anpassung vorschlagen" }).click();
    await expect(editor).toHaveValue(/Glow nur auf Buttons\./);
    await expect(card).toContainText("Vorschlag lokal (e2e-model)");
    await card.getByRole("button", { name: "Datei speichern" }).click();
    await expect(card).toContainText("Gespeichert: .claude/skills/neon/SKILL.md");

    const onDisk = readFileSync(join(hub.alpha, ".claude", "skills", "neon", "SKILL.md"), "utf8");
    expect(onDisk).toContain("Glow nur auf Buttons.");
    expect(onDisk).toMatch(/^---\nname: neon\n/);
    // Kein Duplikat daneben.
    const listed = await hub.api<{ items: { name: string }[] }>(`/api/skills?project=${encodeURIComponent(hub.alpha)}`);
    expect(listed.body.items.filter((i) => i.name.startsWith("neon"))).toHaveLength(1);
  });
  test("ein Speicherkonflikt zeigt den neuen Stand zur erneuten Prüfung", async ({ app, hub }) => {
    await app.getByRole("button", { name: "Neue Session" }).click();
    await app.getByLabel("Adapter").selectOption("opencode");
    await app.getByPlaceholder("Refactore den Auth-Flow…").fill("Lege einen Skill für Neon-Glow an");
    await app.getByRole("button", { name: "Verbessern" }).click();
    const card = app.locator(".recommend-card");
    await expect(card.locator(".recommend-content")).toContainText("Nutze Neonfarben.");
    await card.getByRole("button", { name: "Anpassen", exact: true }).click();
    const file = join(hub.alpha, ".claude", "skills", "neon", "SKILL.md");
    const changed = readFileSync(file, "utf8") + "Zeitgleiche Änderung behalten.\n";
    writeFileSync(file, changed);
    await card.getByLabel("Datei bearbeiten").fill("---\nname: neon\n---\nMein alter Entwurf");
    await card.getByRole("button", { name: "Datei speichern" }).click();
    await expect(card).toContainText("Die Datei wurde inzwischen geändert");
    await expect(card.locator(".recommend-content")).toContainText("Zeitgleiche Änderung behalten.");
    expect(readFileSync(file, "utf8")).toBe(changed);
    await card.getByRole("button", { name: "Anpassen", exact: true }).click();
    await expect(card.getByLabel("Datei bearbeiten")).toHaveValue(changed);
  });

  test("eine inzwischen geänderte Datei wird vor dem Modellvorschlag neu geprüft", async ({ app, hub }) => {
    await app.getByRole("button", { name: "Neue Session" }).click();
    await app.getByLabel("Adapter").selectOption("opencode");
    await app.getByPlaceholder("Refactore den Auth-Flow…").fill("Lege einen Skill für Neon-Glow an");
    await app.getByRole("button", { name: "Verbessern" }).click();
    const card = app.locator(".recommend-card");
    await expect(card.locator(".recommend-content")).toContainText("Nutze Neonfarben.");
    await card.getByRole("button", { name: "Anpassen", exact: true }).click();
    const file = join(hub.alpha, ".claude", "skills", "neon", "SKILL.md");
    const changed = readFileSync(file, "utf8") + "Neuer Stand vor dem Vorschlag.\n";
    writeFileSync(file, changed);
    await card.getByRole("button", { name: "Anpassung vorschlagen" }).click();
    await expect(card).toContainText("Die Datei wurde inzwischen geändert");
    await expect(card.locator(".recommend-content")).toContainText("Neuer Stand vor dem Vorschlag.");
    expect(readFileSync(file, "utf8")).toBe(changed);
  });

  test("während der Optimierung steht ein Spinner statt der Verbessern-Taste (Nutzerauftrag 19.11.2026)", async ({ app }) => {
    slow = true;
    await app.getByRole("button", { name: "Neue Session" }).click();
    await app.getByLabel("Adapter").selectOption("opencode");
    await app.getByPlaceholder("Refactore den Auth-Flow…").fill("mach den suchindex schneller");
    await app.getByRole("button", { name: "Verbessern" }).click();
    const spinner = app.locator('[data-testid="enhance-spinner"]');
    await expect(spinner).toBeVisible();
    await expect(app.getByRole("button", { name: "Verbessern" })).toBeHidden();
    const preview = app.locator(".enhance-preview");
    await expect(preview).toContainText("Ziel: mach den suchindex schneller (lokal)");
    await expect(spinner).toBeHidden();
    await expect(app.getByRole("button", { name: "Verbessern" })).toBeVisible();
  });

});
