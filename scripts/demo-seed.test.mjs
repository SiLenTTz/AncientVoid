import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AdapterRegistry, AttachmentStore, EventStore, FleetStore, HubDatabase, MediaJobs, SessionManager, TokenService } from "@ancientvoid/core";
import { ProcessRunner } from "@ancientvoid/workers";
import { createAdapter as createDummy } from "@ancientvoid/adapter-dummy";
import { createHubApp } from "../apps/hub/src/app.ts";
import { buildDemoWorkspace, seedDemoHub, DEMO_PROJECTS, DEMO_HOSTS } from "./demo-seed.ts";

/** EPIC-P62 T62.3 (AC-P62-6): der Seed erzeugt ausschließlich Allowlist-
 * Werte — Projekte, Hosts, Prompts. Der Test ist der Maßstab, nicht die
 * Intuition des Aufnehmenden. */

describe("demo-seed (EPIC-P62 T62.3)", () => {
  it("seedet nur Allowlist-Projekte und -Hosts; jede Session läuft in einem Demo-Projekt", async () => {
    const root = mkdtempSync(join(tmpdir(), "demo-seed-test-"));
    try {
      const workspace = buildDemoWorkspace(root);
      expect(workspace.map((d) => d.split("/").pop()).sort()).toEqual([...DEMO_PROJECTS].sort());

      const db = new HubDatabase(":memory:");
      const registry = new AdapterRegistry();
      registry.register("dummy", createDummy, { eventsPerSecond: 5, autoStopAfterEvents: 0 });
      const sessions = new SessionManager(db, new EventStore(join(root, "ev")), registry, new ProcessRunner());
      const tokens = new TokenService(db);
      const { token } = tokens.issue("demo-camera");
      const fleet = new FleetStore(db, tokens);
      const media = new MediaJobs(db, { dir: join(root, "media"), attachments: new AttachmentStore(db, join(root, "att")), log: () => undefined });
      const app = await createHubApp({ sessions, tokens, registry, auth: { tokens, enforceTailnetIdentity: false }, hostId: "demo-hub", fleet, media: { media, capabilities: { stt: false, summary: false, vision: false } } });

      const created = await seedDemoHub(app, token, fleet, sessions, workspace);
      expect(created).toHaveLength(4);

      // Nur Allowlist: jede Session in einem Demo-Projekt, kein Fremdname.
      for (const id of created) {
        const rec = sessions.get(id);
        expect(rec, `Session ${id} existiert`).toBeDefined();
        expect(DEMO_PROJECTS, `Projekt von ${id} muss aus der Allowlist kommen: ${rec?.project}`).toContain(rec?.project?.split("/").pop());
      }
      // Fake-Hosts: nur Allowlist-IDs.
      expect(fleet.peers().map((p) => p.hostId).sort()).toEqual([...DEMO_HOSTS].sort());
      // Kein echtes Heimverzeichnis im Seed (Leak-Guard-Netz, AC-P62-6).
      for (const id of created) {
        expect(sessions.get(id)?.project ?? "").not.toMatch(/\/home\/|\/Users\/|C:\\Users\\/);
      }
      await app.close();
      await sessions.shutdown();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
