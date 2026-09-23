import { useEffect, useState } from "preact/hooks";
import { TOOL_GATE_LABEL, featureChips } from "./harness-features.ts";
import { hubApi, type AdapterInfo, type AdapterUsage, type HarnessInventoryEntry } from "../../shared/api.ts";
import { formatWindow } from "../overview/Dashboard.tsx";

/**
 * Real user feedback (2026-09-19): the Dashboard used to open with 7-8
 * lines of adapter/quota text before any session ever appeared — on a
 * real small phone screen that's most of the first screenful, and most
 * lines just repeat "unbekannt (Adapter meldet kein Kontingent)" for
 * adapters that were never going to report a quota in the first place.
 * Moved here, its own page, with room to actually show something useful
 * per provider (capabilities, version) instead of one repetitive line.
 */
export function StatusPage({ adapters, usage }: { adapters: AdapterInfo[]; usage: Record<string, AdapterUsage> }) {
  if (adapters.length === 0) return <div class="empty">lädt …</div>;
  return (
    <div class="status-page">
      {adapters.map((a) => (
        <ProviderCard key={a.id} adapter={a} usage={usage[a.id]} />
      ))}
      <InventoryCard />
    </div>
  );
}

const SUPPORT_LABEL: Record<HarnessInventoryEntry["discovery"], string> = {
  verified: "belegt",
  "implemented-unverified": "gebaut, unbelegt",
  missing: "fehlt",
  blocked: "blockiert",
};

/** T5.1 / ADR-0012: which harness is installed and what the hub can honestly
 * do with it — probed versions, never guessed. */
function InventoryCard() {
  const [items, setItems] = useState<HarnessInventoryEntry[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    hubApi
      .inventory()
      .then((res) => setItems(res.items))
      .catch((err) => setError(err instanceof Error ? err.message : "Inventar nicht erreichbar"));
  }, []);
  return (
    <div class="card inventory-card">
      <div class="provider-card-head">
        <strong>Harness-Inventar</strong>
      </div>
      {error && <div class="dim">{error}</div>}
      {!items && !error && <div class="dim">lädt …</div>}
      {items && (
        <div class="table-scroll">
          <table class="inventory-table">
            <thead>
              <tr>
                <th>Harness</th>
                <th>Version</th>
                <th>Discovery</th>
                <th>Resume</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} title={item.evidence}>
                  <td>{item.id}</td>
                  <td class="mono">{item.version ?? "nicht installiert"}</td>
                  <td class={`support ${item.discovery}`}>{SUPPORT_LABEL[item.discovery]}</td>
                  <td class={`support ${item.resume}`}>{SUPPORT_LABEL[item.resume]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ProviderCard({ adapter, usage }: { adapter: AdapterInfo; usage?: AdapterUsage }) {
  const caps = adapter.capabilities;
  return (
    <div class="card provider-card">
      <div class="provider-card-head">
        <strong>{adapter.id}</strong>
        <span class="dim">v{adapter.version}</span>
      </div>
      <div class="provider-card-chips">
        {featureChips(caps.features).map((label) => (
          <span key={label} class="chip subtle">
            {label}
          </span>
        ))}
        {caps.reasoning && <span class="chip subtle">Reasoning</span>}
        {caps.cost && <span class="chip subtle">Kosten</span>}
      </div>
      <div class={caps.features.toolGate === "bypass" ? "tool-gate warn" : "tool-gate dim"}>{TOOL_GATE_LABEL[caps.features.toolGate]}</div>
      <div class="dim">{quotaLine(usage)}</div>
    </div>
  );
}

/** R9.7: `supported:false` reads as "dieser Adapter meldet grundsätzlich
 * kein Kontingent" (a real, verified capability absence) — short, once,
 * never the same explanatory sentence repeated per adapter like the old
 * Dashboard row did. */
function quotaLine(usage: AdapterUsage | undefined): string {
  if (!usage || !usage.supported) return "Kein Kontingent-Signal";
  if (usage.quota === null) return "Kontingent: noch keine Meldung";
  const windows = usage.quota.windows.map(formatWindow).join(" · ");
  const overage =
    usage.quota.overageAvailable === false ? ` · ${usage.quota.overageBlockedReason ?? "kein Guthaben"}` : "";
  return `Kontingent: ${windows}${overage}`;
}
