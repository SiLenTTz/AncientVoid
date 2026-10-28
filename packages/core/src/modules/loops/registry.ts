import type { LoopInfo, LoopSpec } from "@uacc/contracts";

/**
 * Bekannte Loops (EPIC-P19). Ein Eintrag ist sichtbar, sobald er hier steht;
 * startbar ist er erst, wenn ein Connector registriert ist (T19.4/T19.5).
 */
const CATALOG: readonly Omit<LoopInfo, "available" | "reason">[] = [
  {
    id: "aspark-factory",
    label: "aSPARK-Factory",
    description: "Docker-Lines mit MQTT-Leitstand, Modus dark = Dark Factory.",
    transport: "mqtt",
    options: [],
  },
  {
    id: "securesight-factory",
    label: "securesight-factory",
    description: "Harnez-Loop-Runner mit Watchdog (Adapter securesight-harnez), Orchestrator wählbar.",
    transport: "cli",
    options: [
      {
        key: "orchestrator",
        label: "Orchestrator",
        values: [
          { value: "self", label: "selbst" },
          { value: "hermes", label: "Hermes" },
        ],
        default: "self",
      },
    ],
  },
];

export const NO_CONNECTOR_REASON = "Connector noch nicht angebunden (EPIC-P19 T19.4/T19.5)";

export class LoopRegistry {
  private readonly connected = new Set<string>();

  /** Ein Connector meldet sich an; ab dann ist der Loop startbar. */
  markConnected(id: string): void {
    this.connected.add(id);
  }

  list(): LoopInfo[] {
    return CATALOG.map((loop) =>
      this.connected.has(loop.id) ? { ...loop, available: true } : { ...loop, available: false, reason: NO_CONNECTOR_REASON },
    );
  }

  /** Prüft eine Startauswahl; wirft mit lesbarem Grund. */
  assertStartable(spec: LoopSpec): LoopInfo {
    const loop = this.list().find((l) => l.id === spec.id);
    if (!loop) throw new Error(`unbekannter Loop „${spec.id}“`);
    if (!loop.available) throw new Error(`Loop „${loop.label}“ ist nicht startbar: ${loop.reason}`);
    for (const [key, value] of Object.entries(spec.options ?? {})) {
      const option = loop.options.find((o) => o.key === key);
      if (!option) throw new Error(`Loop „${loop.label}“ kennt die Option „${key}“ nicht`);
      if (!option.values.some((v) => v.value === value)) throw new Error(`Option „${key}“ hat keinen Wert „${value}“`);
    }
    return loop;
  }
}
