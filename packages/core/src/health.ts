import type { HubHealthCheck, HubHealthReport, HubHealthStatus } from "@uacc/contracts";
import type { AdapterRegistry } from "./registry.ts";
import type { SessionManager } from "./sessionmanager.ts";

export interface HealthStore {
  probe(): Promise<void>;
}

export interface HealthDeps {
  startedAt: number;
  sessions: SessionManager;
  registry: AdapterRegistry;
  store?: HealthStore;
}

function asCheck(run: () => void): HubHealthCheck {
  try {
    run();
    return { ok: true };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

async function asAsyncCheck(run: () => Promise<void>): Promise<HubHealthCheck> {
  try {
    await run();
    return { ok: true };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

export async function collectHealth(deps: HealthDeps): Promise<HubHealthReport> {
  const database = asCheck(() => {
    deps.sessions.list();
  });
  const store = deps.store;
  const eventStore = store
    ? await asAsyncCheck(() => store.probe())
    : { ok: true, detail: "not probed" };

  const counts = deps.sessions.sessionCounts();
  const adapters = deps.registry.list().map((a) => ({
    id: a.id,
    version: a.adapter.version,
    capabilities: a.capabilities,
    module: a.module,
  }));

  let status: HubHealthStatus = "ok";
  if (!database.ok || !eventStore.ok) status = "down";

  return {
    ok: status !== "down",
    status,
    serverTime: new Date().toISOString(),
    uptimeSec: Math.max(0, Math.round((Date.now() - deps.startedAt) / 1000)),
    adapters,
    sessions: counts,
    checks: { database, eventStore },
  };
}
