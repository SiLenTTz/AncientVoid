import { describe, expect, it } from "vitest";
import { projectName, projectTail } from "../../src/shared/project-name.ts";

describe("projectName (BUG-0196)", () => {
  it("takes the last segment of POSIX and Windows paths", () => {
    expect(projectName("/home/demo/repos/website")).toBe("website");
    expect(projectName("C:\\Users\\demo\\repos\\website")).toBe("website");
    expect(projectName("\\\\server\\share\\api")).toBe("api");
    expect(projectName("C:/mixed\\style/path")).toBe("path");
  });

  it("ignores trailing separators and keeps bare names", () => {
    expect(projectName("D:\\work\\api\\")).toBe("api");
    expect(projectName("/repos/website/")).toBe("website");
    expect(projectName("website")).toBe("website");
  });

  it("returns the input when there is no segment", () => {
    expect(projectName("")).toBe("");
    expect(projectName("/")).toBe("/");
  });
});

describe("projectTail (BUG-0196)", () => {
  it("joins the last n segments with a slash on every platform", () => {
    expect(projectTail("/home/demo/repos/website", 2)).toBe("repos/website");
    expect(projectTail("C:\\Users\\demo\\repos\\website", 2)).toBe("repos/website");
  });
});
