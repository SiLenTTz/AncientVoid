import { useEffect, useState } from "preact/hooks";
import type { AdapterInfo, AdapterUsage, FleetHost, SessionRecord } from "../../shared/api.ts";

/**
 * EPIC-P23 T23.2: what the status bar shows about the hub. `App` already polls sessions, fleet and
 * approvals every 3 s and publishes its result here — no second loop, no second request.
 * EPIC-P34 T34.2: the tool pane (settings, media, status …) reads adapters and usage from here, too.
 */
export interface HubStatus {
  /** False after the second failed poll in a row (BUG-0045: one failure is no outage). */
  connected: boolean;
  error: string;
  /** Timestamp of the last successful poll, null before the first. */
  lastOkAt: number | null;
  sessions: SessionRecord[];
  hosts: FleetHost[];
  pendingApprovals: number;
  adapters: AdapterInfo[];
  usage: Record<string, AdapterUsage>;
}

let hub: HubStatus = { connected: true, error: "", lastOkAt: null, sessions: [], hosts: [], pendingApprovals: 0, adapters: [], usage: {} };
const subscribers = new Set<() => void>();

export function publishHubStatus(next: Partial<HubStatus>): void {
  hub = { ...hub, ...next };
  subscribers.forEach((fn) => fn());
}

export function getHubStatus(): HubStatus {
  return hub;
}

/** Re-renders at most once per `everyMs` however often `App` publishes. */
export function useHubStatus(everyMs = 1000): HubStatus {
  const [snapshot, setSnapshot] = useState(hub);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const flush = () => {
      timer = null;
      setSnapshot(hub);
    };
    const onChange = () => {
      if (timer === null) timer = setTimeout(flush, everyMs);
    };
    subscribers.add(onChange);
    flush();
    return () => {
      subscribers.delete(onChange);
      if (timer !== null) clearTimeout(timer);
    };
  }, [everyMs]);
  return snapshot;
}
