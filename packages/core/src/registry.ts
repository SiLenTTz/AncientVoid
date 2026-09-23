import type { Adapter, AdapterCapabilities, AdapterFactory } from "@uacc/contracts";
import { basicFeatures, isValidAdapterFactory } from "@uacc/contracts";
import { resolveAdapterModule, type AdapterRegistration } from "./config.ts";

/**
 * Adapter registry — the extension point of the hub (PRD §4.2).
 *
 * Adapters are normal modules exporting `createAdapter(config?)`. They can be
 *  - built-in packages from this repo (`@uacc/adapter-dummy`, …),
 *  - any npm package,
 *  - a local file/directory referenced from hub.config.json.
 *
 * A misbehaving adapter never takes the hub down: failures are surfaced as
 * registry errors, sessions using that adapter fail loudly.
 */
export interface RegisteredAdapter {
  id: string;
  module: string;
  adapter: Adapter;
  capabilities: ReturnType<Adapter["capabilities"]>;
}

/** ADR-0018: adapters written before `features` existed get the cautious
 * reading — follow-up only if they steer, tools as if they ran unasked. */
function withFeatures(caps: AdapterCapabilities): AdapterCapabilities {
  if ((caps as Partial<AdapterCapabilities>).features) return caps;
  return {
    ...caps,
    features: basicFeatures({ followUp: caps.steer, interrupt: caps.steer, toolGate: caps.tools ? "bypass" : "none" }),
  };
}

export class AdapterRegistry {
  private readonly adapters = new Map<string, RegisteredAdapter>();

  /** Register an already-instantiated adapter (built-ins, tests). */
  register(id: string, factory: AdapterFactory, config?: Record<string, unknown>, module = "builtin"): void {
    const adapter = factory(config);
    this.adapters.set(id, {
      id,
      module,
      adapter,
      capabilities: withFeatures(adapter.capabilities()),
    });
  }

  /** Dynamically load one registration entry. */
  async load(registration: AdapterRegistration, configPath: string): Promise<void> {
    const spec = await resolveAdapterModule(registration.module, configPath);
    const mod = await import(/* @vite-ignore */ spec);
    const factoryMod = isValidAdapterFactory(mod) ? mod : isValidAdapterFactory(mod.default) ? mod.default : null;
    if (!factoryMod) {
      throw new Error(
        `adapter module "${registration.module}" does not export createAdapter(config?) => Adapter`,
      );
    }
    this.register(registration.id, factoryMod.createAdapter, registration.config, registration.module);
  }

  async loadAll(registrations: readonly AdapterRegistration[], configPath: string): Promise<void> {
    const errors: string[] = [];
    for (const reg of registrations) {
      if (!reg.enabled) continue;
      try {
        await this.load(reg, configPath);
      } catch (err) {
        errors.push(`${reg.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (errors.length > 0) {
      throw new Error(`adapter loading failed — ${errors.join("; ")}`);
    }
  }

  get(id: string): RegisteredAdapter | undefined {
    return this.adapters.get(id);
  }

  require(id: string): RegisteredAdapter {
    const found = this.adapters.get(id);
    if (!found) {
      throw new Error(
        `unknown adapter "${id}" — registered: ${[...this.adapters.keys()].join(", ") || "(none)"}`,
      );
    }
    return found;
  }

  list(): RegisteredAdapter[] {
    return [...this.adapters.values()];
  }
}
