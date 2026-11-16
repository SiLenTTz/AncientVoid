import { LOOP_NEW } from "@ancientvoid/contracts";
import type { LoopConnector, LoopInfo, LoopSpec, LoopStartSpec } from "@ancientvoid/contracts";

/**
 * Bekannte Loops (EPIC-P19). Sie stehen in der Auswahl, sobald dieser Katalog sie kennt; startbar werden sie
 * mit einem geladenen Connector (`loops[]` in hub.config.json). Ohne Connector sichtbar und gesperrt, mit Grund.
 */
const CATALOG: readonly Pick<LoopInfo, "id" | "label" | "description" | "transport">[] = [
  { id: "aspark-factory", label: "aSPARK-Factory", description: "Docker-Lines mit MQTT-Leitstand, Betriebsart dark = Dark Factory.", transport: "mqtt" },
  { id: "securesight-factory", label: "securesight-factory", description: "Factory-Loop mit Watchdog (Repo-Modus) und Projektmodus über die factory-CLI, Orchestrator wählbar.", transport: "cli" },
];

export const NOT_CONFIGURED_REASON = "nicht eingerichtet — Eintrag in loops[] von hub.config.json fehlt (docs/loops.md)";

export class LoopRegistry {
  private readonly connectors = new Map<string, LoopConnector>();
  private readonly failures = new Map<string, string>();

  /** Ein geladener Connector macht seinen Loop startbar. */
  register(connector: LoopConnector): void {
    this.connectors.set(connector.id, connector);
    this.failures.delete(connector.id);
  }

  /** Ein konfigurierter Loop, der nicht lädt, bleibt sichtbar — mit dem Grund (Regel 6). */
  markFailed(id: string, reason: string): void {
    this.failures.set(id, reason);
  }

  connector(id: string): LoopConnector | undefined {
    return this.connectors.get(id);
  }

  list(): LoopInfo[] {
    const known = new Map(CATALOG.map((c) => [c.id as string, c]));
    for (const id of [...this.connectors.keys(), ...this.failures.keys()]) {
      if (!known.has(id)) known.set(id, { id, label: id, description: "Loop aus hub.config.json", transport: "cli" });
    }
    return [...known.values()].map((meta): LoopInfo => {
      const connector = this.connectors.get(meta.id);
      if (connector) return { ...meta, available: true, capabilities: connector.capabilities() };
      return { ...meta, available: false, reason: this.failures.get(meta.id) ?? NOT_CONFIGURED_REASON, capabilities: null };
    });
  }

  /** Prüft eine Startauswahl gegen die Fähigkeiten; wirft mit lesbarem Grund (fail loud). */
  assertStartable(spec: LoopSpec): LoopInfo {
    const loop = this.list().find((l) => l.id === spec.id);
    if (!loop) throw new Error(`unbekannter Loop „${spec.id}“`);
    const caps = loop.capabilities;
    if (!loop.available || !caps) throw new Error(`Loop „${loop.label}“ ist nicht startbar: ${loop.reason}`);
    if (spec.mode !== undefined && !caps.modes.includes(spec.mode)) throw new Error(`Betriebsart „${spec.mode}“ gibt es bei „${loop.label}“ nicht (${caps.modes.join(", ") || "keine"})`);
    if (spec.orchestrator !== undefined && !caps.orchestrators.includes(spec.orchestrator)) throw new Error(`Orchestrator „${spec.orchestrator}“ gibt es bei „${loop.label}“ nicht`);
    const options = spec.options ?? {};
    for (const key of Object.keys(options)) {
      // ADR-0043: hub-interne Verknüpfung Treiber↔Beobachter — kein Connector-Feld, nie im Startformular.
      if (key === "driver") continue;
      if (!caps.options.some((o) => o.key === key)) throw new Error(`„${loop.label}“ kennt die Option „${key}“ nicht`);
    }
    for (const o of caps.options) {
      const value = options[o.key];
      if (o.required && !value?.trim()) throw new Error(`Option „${o.label}“ fehlt`);
      if (value === LOOP_NEW) throw new Error(`„${o.label}“: das neue Repo muss erst angebunden werden`);
      if (value !== undefined && o.kind === "select" && !o.choices?.some((c) => c.value === value)) throw new Error(`Option „${o.label}“ hat keinen Wert „${value}“`);
    }
    return loop;
  }
}

/** Die Auswahl des Clients als Startvorgabe des Connectors; Voreinstellungen füllt der Connector selbst. */
export function toStartSpec(spec: LoopSpec, base: { project: string; goal?: string | undefined }): LoopStartSpec {
  return {
    project: base.project,
    ...(base.goal ? { goal: base.goal } : {}),
    ...(spec.mode ? { mode: spec.mode } : {}),
    ...(spec.orchestrator ? { orchestrator: spec.orchestrator } : {}),
    options: { ...spec.options },
  };
}

