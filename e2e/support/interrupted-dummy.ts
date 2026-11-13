import { createAdapter as createDummy } from "@ancientvoid/adapter-dummy";
import type { Adapter, WorkerProcess } from "@ancientvoid/contracts";

/** P27: deterministic transport failure in an isolated test hub only. */
export function createAdapter(config?: Readonly<Record<string, unknown>>): Adapter {
  const base = createDummy(config);
  const workers = new Map<string, WorkerProcess>();
  return {
    ...base,
    async start(spec, ctx) {
      if (spec.args?.resumeSessionId && config?.failResume === true) throw new Error("P27: Wiederaufnahme fehlgeschlagen");
      const proc = await ctx.spawnWorker([process.execPath, "-e", "process.stdin.resume()"], { persistent: true });
      workers.set(ctx.sessionId, proc);
      return base.start(spec, ctx);
    },
    async steer(handle, input, ctx) {
      if (input.kind === "prompt" && input.text === "P27: worker transport lost") {
        await workers.get(handle.sessionId)?.kill("SIGKILL");
        return { ok: true };
      }
      return base.steer(handle, input, ctx);
    },
    async recover() { return null; },
    async stop(handle, ctx) {
      await workers.get(handle.sessionId)?.kill("SIGTERM");
      workers.delete(handle.sessionId);
      await base.stop(handle, ctx);
    },
  };
}
