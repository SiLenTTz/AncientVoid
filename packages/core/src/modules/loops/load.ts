import { isValidLoopFactory } from "@uacc/contracts";
import { resolveAdapterModule } from "../../platform/index.ts";
import type { LoopRegistration } from "../../platform/index.ts";
import type { LoopRegistry } from "./registry.ts";

/**
 * Lädt die `loops[]` der Konfiguration. Ein Loop, der nicht lädt, nimmt den Hub nicht mit: er bleibt in der
 * Auswahl sichtbar, gesperrt und mit dem Grund (Regel 6), und die Fehler kommen gesammelt zurück.
 */
export async function loadLoops(registry: LoopRegistry, registrations: readonly LoopRegistration[], configPath: string): Promise<string[]> {
  const errors: string[] = [];
  for (const reg of registrations) {
    if (!reg.enabled) continue;
    try {
      const spec = await resolveAdapterModule(reg.module, configPath);
      const mod = await import(/* @vite-ignore */ spec);
      const factory = isValidLoopFactory(mod) ? mod : isValidLoopFactory(mod.default) ? mod.default : null;
      if (!factory) throw new Error(`Modul „${reg.module}“ exportiert createLoopConnector(config?) nicht`);
      const connector = factory.createLoopConnector(reg.config);
      if (connector.id !== reg.id) throw new Error(`Connector meldet die Id „${connector.id}“, konfiguriert ist „${reg.id}“`);
      registry.register(connector);
    } catch (err) {
      const reason = `Connector konnte nicht geladen werden: ${err instanceof Error ? err.message : String(err)}`;
      registry.markFailed(reg.id, reason);
      errors.push(`${reg.id}: ${reason}`);
    }
  }
  return errors;
}
