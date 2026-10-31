import { describe, expect, it } from "vitest";
describe("commands for another host (T6.6)", async () => {
  const { onHost } = await import("../../../src/features/session/HostCommands.tsx");
  it("wraps a remote command in ssh, leaves this hub's alone", () => {
    expect(onHost("cd /w && opencode --session s1", "silenttz-server")).toBe("ssh -t silenttz-server 'cd /w && opencode --session s1'");
    expect(onHost("tmux attach -t ancientvoid-x", null)).toBe("tmux attach -t ancientvoid-x");
    expect(onHost("echo 'x'", "h")).toBe(`ssh -t h 'echo '\\''x'\\'''`);
  });
});
