import { describe, expect, it } from "vitest";
import { notificationFor, projectName } from "../../../src/modules/notifications/index.ts";

/** BUG-0196: a Windows hub reports projects as `C:\…` paths; texts must name the project, not the path. */
describe("project names on a Windows hub (BUG-0196)", () => {
  it("notification titles use the last path segment, never the whole path with the user name", () => {
    const event = { type: "system", summary: "x", payload: { kind: "session.interrupted", reason: "Hub neu gestartet" } } as unknown as Parameters<typeof notificationFor>[0];
    const draft = notificationFor(event, { adapter: "claude", project: "C:\\Users\\demo\\repos\\alpha" });
    expect(draft?.title).toBe("alpha · Session unterbrochen");
  });

  it("projectName handles POSIX, Windows, UNC and trailing separators", () => {
    expect(projectName("/home/demo/repos/alpha")).toBe("alpha");
    expect(projectName("C:\\Users\\demo\\repos\\alpha")).toBe("alpha");
    expect(projectName("\\\\server\\share\\alpha")).toBe("alpha");
    expect(projectName("D:\\work\\api\\")).toBe("api");
    expect(projectName("alpha")).toBe("alpha");
  });
});
