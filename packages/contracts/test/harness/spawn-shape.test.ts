import { describe, expect, it } from "vitest";
import { classifyArgv, spawnArgv } from "../../src/harness/spawn-shape.ts";

/**
 * BUG-0179: Windows kann Shebang-Skripte ohne Endung nicht direkt starten. Die Lösung darf
 * keine Shell-Schicht vor die Attrappe setzen (zerstört Stdio-Pipes und Exit-Semantik —
 * gemessen: 13 × 15 s Timeout in codex/app-server.test.ts), sondern stellt Node vor den
 * Skriptpfad.
 *
 * `classifyArgv` ist absichtlich rein (Plattform und Node-Pfad als Parameter, kein
 * Dateisystem — contracts lebt auch im Browser-Bundel), damit sich das Verhalten auf jedem
 * Entwicklerrechner beweisen lässt: auf Linux wie auf Kais Windows-Desk.
 */
describe("Spawn-Form für konfigurierte Provider-Kommandos (BUG-0179)", () => {
  it("lässt auf Unix alles unverändert", () => {
    expect(classifyArgv("/opt/av/claude", ["--json"], "linux", "/usr/bin/node")).toEqual({
      file: "/opt/av/claude",
      args: ["--json"],
    });
  });

  it("stellt auf Windows Node vor ein Skript ohne Endung — ohne Shell", () => {
    const got = classifyArgv("E:\\av\\bin\\claude", ["--print"], "win32", "C:\\node\\node.exe");
    expect(got).toEqual({ file: "C:\\node\\node.exe", args: ["E:\\av\\bin\\claude", "--print"] });
    expect(got.shell).toBeUndefined();
  });

  it("stellt auf Windows Node auch vor ein .mjs- oder .js-Skript", () => {
    expect(classifyArgv("E:\\av\\fixtures\\glab-stub.mjs", ["api", "mr"], "win32", "N").file).toBe("N");
    expect(classifyArgv("E:\\av\\probe.js", [], "win32", "N").args).toEqual(["E:\\av\\probe.js"]);
  });

  it("lässt echte Programme (.exe/.com) und PATH-Namen unangetastet", () => {
    expect(classifyArgv("C:\\git\\bin\\git.exe", ["status"], "win32", "N")).toEqual({
      file: "C:\\git\\bin\\git.exe",
      args: ["status"],
    });
    // Karger Name ohne Trenner: das löst der PATH auf, Node darf nicht dazwischenfunktionieren.
    expect(classifyArgv("git", ["status"], "win32", "N")).toEqual({ file: "git", args: ["status"] });
  });

  it("nutzt für .cmd/.bat die Shell — CreateProcess kann die gar nicht", () => {
    expect(classifyArgv("E:\\tools\\yt-dlp.cmd", ["-v"], "win32", "N")).toEqual({
      file: "E:\\tools\\yt-dlp.cmd",
      args: ["-v"],
      shell: true,
    });
  });

  it("fällt auf den realen Node-Pfad zurück, wenn keiner übergeben wird", () => {
    expect(classifyArgv("E:\\av\\bin\\claude", [], "win32").file).toBe(process.execPath);
  });

  it("spawnArgv nimmt die reale Plattform und erhält die Argumente", () => {
    const got = spawnArgv("git", ["--version"]);
    expect(got.file.length).toBeGreaterThan(0);
    expect(got.args).toContain("--version");
  });
});
