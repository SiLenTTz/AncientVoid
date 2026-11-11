import { describe, expect, it } from "vitest";
import { ProcessRunner } from "../src/process.ts";

describe("ProcessRunner (BUG-0119)", () => {
  it("ein gebrochenes stdin (EPIPE) wird als stderr gemeldet statt den Hub zu beenden", async () => {
    // Das Kind schließt seine Eingabe und lebt weiter — wie ein Agent, der stdin nicht mehr liest.
    const worker = await new ProcessRunner().spawn({ name: "bug-0119", cmd: ["sh", "-c", "exec 0<&-; sleep 1"], cwd: process.cwd(), env: {} });
    const stderr: string[] = [];
    worker.onStderr((chunk) => stderr.push(chunk));
    await new Promise((resolve) => setTimeout(resolve, 200));
    worker.write("x".repeat(1 << 20));
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(stderr.join("")).toMatch(/^stdin: .*EPIPE/m);
    await worker.kill();
  });

  it("Schreiben an ein beendetes Kind geht nicht still verloren", async () => {
    const worker = await new ProcessRunner().spawn({ name: "bug-0119-exit", cmd: [process.execPath, "-e", ""], cwd: process.cwd(), env: {} });
    const stderr: string[] = [];
    worker.onStderr((chunk) => stderr.push(chunk));
    await worker.exited();
    worker.write("hallo");
    expect(stderr.join("")).toMatch(/^stdin: /m);
  });
});
