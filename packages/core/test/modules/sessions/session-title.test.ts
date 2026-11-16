import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventStore, HubDatabase, SessionManager, AdapterRegistry, sessionTitle } from "../../../src/index.ts";
import { ProcessRunner } from "@ancientvoid/workers";
import { createAdapter as createDummy } from "@ancientvoid/adapter-dummy";

describe("session titles for the overview", () => {
  it("takes the first line that says something", () => {
    expect(sessionTitle("Workflow: release\n\nBaue das Login")).toBe("Baue das Login");
    expect(sessionTitle("/neon\n\nMach es bunt\nmehr Text")).toBe("Mach es bunt");
    expect(sessionTitle("Ziel: Tetris für Mobile\nScope: x")).toBe("Tetris für Mobile");
    expect(sessionTitle("   \n")).toBeNull();
    expect(sessionTitle("x".repeat(120))?.length).toBe(80);
  });

  it("stores it with the session and survives a restart; a first reply fills an empty one", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ancientvoid-title-"));
    const dbFile = join(dir, "hub.db");
    const db = new HubDatabase(dbFile);
    const registry = new AdapterRegistry();
    registry.register("dummy", createDummy, { eventsPerSecond: 5, autoStopAfterEvents: 0 });
    const manager = new SessionManager(db, new EventStore(dir), registry, new ProcessRunner());
    try {
      const withPrompt = await manager.create({ adapter: "dummy", project: dir, prompt: "Baue ein Tetris" });
      expect(withPrompt.title).toBe("Baue ein Tetris");
      const empty = await manager.create({ adapter: "dummy", project: dir });
      expect(empty.title).toBeNull();
      await manager.steer(empty.id, { kind: "prompt", text: "Jetzt die Tests" });
      expect(manager.get(empty.id)?.title).toBe("Jetzt die Tests");
      await manager.shutdown();
      const reopened = new HubDatabase(dbFile);
      const again = new SessionManager(reopened, new EventStore(dir), registry, new ProcessRunner());
      expect(again.get(withPrompt.id)?.title).toBe("Baue ein Tetris");
      reopened.close();
    } finally {
      db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("EPIC-P15 T15.5: Höflichkeitsfloskeln fallen aus dem Titel", () => {
  it("nimmt das Wesentliche statt „Kannst du mir sagen, ob …“", () => {
    expect(sessionTitle("Kannst du mir sagen, ob inzwischen die richtigen Sessions hier zu sehen sind?")).toBe("Ob inzwischen die richtigen Sessions hier zu sehen sind");
    expect(sessionTitle("Ich würde gern den aktuellen Stand des repos wissen")).toBe("Den aktuellen Stand des repos wissen");
    expect(sessionTitle("Bitte erstelle ein neues Epic für die Settings")).toBe("Erstelle ein neues Epic für die Settings");
    expect(sessionTitle("Hallo, kannst du bitte die Tests laufen lassen?")).toBe("Die Tests laufen lassen");
    expect(sessionTitle("Could you review the login flow?")).toBe("Review the login flow");
  });

  it("lässt echte Aufträge und kurze Wörter in Ruhe", () => {
    expect(sessionTitle("Bitte")).toBe("Bitte"); // nichts anderes da: nicht leeren
    expect(sessionTitle("Baue ein Tetris")).toBe("Baue ein Tetris");
    expect(sessionTitle("Hallo")).toBe("Hallo");
    expect(sessionTitle("Antworte nur mit: codex ok")).toBe("Antworte nur mit: codex ok");
  });

  it("entfernt Satzzeichen am Ende und Markdown-Auszeichnung", () => {
    expect(sessionTitle("## Settings-Seite verbessern.")).toBe("Settings-Seite verbessern");
    expect(sessionTitle("**Wichtig**: Login fixen!")).toBe("Wichtig: Login fixen");
  });
});
