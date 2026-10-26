import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decideOrphans, discoverTmuxServers, liveHubRoots, listServerWorkers, findOrphanedWorkers, DEFAULT_SERVER, type ServerWorkers } from "../src/orphans.ts";

describe("decideOrphans (BUG-0034) — rein", () => {
  const servers: ServerWorkers[] = [
    {
      server: DEFAULT_SERVER,
      sessions: [
        { name: "uacc-live", owner: "a", logDir: "/hub/data/workers" },
        { name: "uacc-gone", owner: "b", logDir: "/tmp/weg/data/workers" },
        { name: "uacc-unmarked", owner: "c", logDir: null },
      ],
    },
    { server: "/tmp/uacc-p7-alt", sessions: [{ name: "uacc-x", owner: "d", logDir: "/tmp/uacc-p7-alt/data/workers" }] },
    { server: "/tmp/uacc-p7-live", sessions: [{ name: "uacc-y", owner: "e", logDir: "/tmp/uacc-p7-live/data/workers" }] },
  ];

  it("killt ganze Wegwerf-Server ohne lebenden Hub, einzeln nur Tote im Standard-Server", () => {
    const live = new Set(["/tmp/uacc-p7-live", "/hub"]);
    const exists = (d: string) => d.startsWith("/hub") || d.startsWith("/tmp/uacc-p7-live") || d.startsWith("/tmp/uacc-p7-alt");
    const d = decideOrphans(servers, live, exists);
    expect(d.killServers).toEqual(["/tmp/uacc-p7-alt"]);
    expect(d.killSessions).toEqual([{ server: DEFAULT_SERVER, name: "uacc-gone" }]);
  });

  it("ohne Marke wird nie geraten — unmarkierte Sessions bleiben", () => {
    const d = decideOrphans(servers, new Set(), () => false);
    expect(d.killSessions.some((s) => s.name === "uacc-unmarked")).toBe(false);
  });

  it("leere Server (nur Socket-Hülle) werden nicht gekillt — kein Nutzen, kein Risiko", () => {
    const d = decideOrphans([{ server: "/tmp/uacc-leer", sessions: [] }], new Set(), () => true);
    expect(d.killServers).toEqual([]);
  });

  it("liveHubRoots liest UACC_CONFIG aus /proc-artigen Umgebungen", () => {
    const roots = liveHubRoots(
      () => "PATH=/usr/bin\0UACC_CONFIG=/tmp/uacc-p7-live/hub.config.json\0",
      [42],
    );
    expect([...roots]).toEqual(["/tmp/uacc-p7-live"]);
    expect([...liveHubRoots(() => "PATH=/usr/bin\0", [42])]).toEqual([]);
  });
});

describe("discoverTmuxServers + findOrphanedWorkers (BUG-0034) — integration", () => {
  it("findet Socket-Roots und erkennt den eigenen Wegwerf-Server als Waisen", async () => {
    const parent = mkdtempSync(join(tmpdir(), "uacc-orph-parent-"));
    const root = join(parent, "uacc-orph");
    mkdirSync(root, { recursive: true });
    try {
      const { execFileSync } = await import("node:child_process");
      execFileSync("tmux", ["-f", "/dev/null", "new-session", "-d", "-s", "uacc-orphantest", "sleep 5"], {
        env: { ...process.env, TMUX_TMPDIR: root, TMUX: "" },
        stdio: "ignore",
      });
      // T17.5/ADR-0037: the marker columns a marker-based prune reads.
      execFileSync("tmux", ["set-option", "-t", "uacc-orphantest", "@uacc_session", "sess-42"], {
        env: { ...process.env, TMUX_TMPDIR: root, TMUX: "" },
        stdio: "ignore",
      });
      expect(discoverTmuxServers(parent)).toContain(root);
      const listed = await listServerWorkers(root);
      expect(listed.sessions.map((s) => s.name)).toEqual(["uacc-orphantest"]);
      expect(listed.sessions[0]?.sessionId).toBe("sess-42");
      expect(listed.sessions[0]?.cwd).toBeTruthy(); // #{pane_current_path}
      // kein lebender Hub in diesem Root → die ganze Server-Entscheidung
      const found = await findOrphanedWorkers(parent);
      expect(found.killServers).toContain(root);
    } finally {
      const { execFileSync } = await import("node:child_process");
      try {
        execFileSync("tmux", ["kill-server"], { env: { ...process.env, TMUX_TMPDIR: root, TMUX: "" }, stdio: "ignore" });
      } catch {
        // schon weg
      }
      rmSync(parent, { recursive: true, force: true });
    }
  }, 15_000);
});

describe("existsSync-Nutzung", () => {
  it("dirExists-Check der Entscheidung ist die Platten-Realität", () => {
    expect(existsSync(tmpdir())).toBe(true);
  });
});
