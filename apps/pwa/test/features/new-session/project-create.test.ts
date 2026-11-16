import { describe, expect, it, vi } from "vitest";
import { createProjectOnHost } from "../../../src/features/new-session/CreateSession.tsx";
import type { DiscoveredProject, HubApi } from "../../../src/shared/api.ts";

const fern: DiscoveredProject = { path: "/srv/git/fern", name: "fern", branch: "main", isGit: true };

describe("createProjectOnHost (BUG-0188)", () => {
  it("legt an und lädt die Liste über denselben host-gebundenen API-Stub", async () => {
    const createProject = vi.fn().mockResolvedValue({ ok: true, created: true, project: fern });
    const projects = vi.fn().mockResolvedValue({ projects: [fern], warnings: [], rootsConfigured: true, roots: ["/srv/git"] });
    const api = { createProject, projects } as unknown as HubApi;

    await expect(createProjectOnHost(api, "fern")).resolves.toEqual({ projects: [fern], project: "/srv/git/fern" });
    expect(createProject).toHaveBeenCalledWith("fern");
    expect(projects).toHaveBeenCalledTimes(1);
  });

  it("fragt die Liste nicht an, wenn der Host das Anlegen abgelehnt hat", async () => {
    const createProject = vi.fn().mockResolvedValue({ ok: false, created: false, project: null });
    const projects = vi.fn();
    const api = { createProject, projects } as unknown as HubApi;

    await expect(createProjectOnHost(api, "x")).resolves.toBe(null);
    expect(projects).not.toHaveBeenCalled();
  });
});
