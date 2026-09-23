import { describe, expect, it } from "vitest";
import { nativeOpenCommand } from "../../../src/index.ts";

describe("nativeOpenCommand (T5.5)", () => {
  it("builds the verified resume command per harness", () => {
    expect(nativeOpenCommand("claude", "abc-1", "/work/alpha")).toBe("cd /work/alpha && claude --resume abc-1");
    expect(nativeOpenCommand("codex", "t-1", "/work/alpha")).toBe("cd /work/alpha && codex resume t-1");
    expect(nativeOpenCommand("opencode", "ses_1", "/work/alpha")).toBe("cd /work/alpha && opencode --session ses_1");
    expect(nativeOpenCommand("copilot", "c-1", "/work/alpha")).toBe("cd /work/alpha && copilot --resume c-1");
  });

  it("quotes paths and ids that a shell would split", () => {
    expect(nativeOpenCommand("opencode", "a b", "/work/mein projekt")).toBe("cd '/work/mein projekt' && opencode --session 'a b'");
    expect(nativeOpenCommand("opencode", "x';rm -rf ~;'", "/w")).toBe(`cd /w && opencode --session 'x'\\'';rm -rf ~;'\\'''`);
  });

  it("gives nothing without an id or a native open", () => {
    expect(nativeOpenCommand("opencode", null, "/w")).toBeNull();
    expect(nativeOpenCommand("aider", "x", "/w")).toBeNull();
    expect(nativeOpenCommand("dummy", "x", "/w")).toBeNull();
  });
});
