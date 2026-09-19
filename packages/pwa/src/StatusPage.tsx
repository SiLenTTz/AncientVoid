import type { AdapterInfo, AdapterUsage } from "./api.ts";
import { formatWindow } from "./Dashboard.tsx";

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
        {caps.reasoning && <span class="chip subtle">Reasoning</span>}
        {caps.tools && <span class="chip subtle">Tools</span>}
        {caps.cost && <span class="chip subtle">Kosten</span>}
        {caps.steer && <span class="chip subtle">Steer</span>}
        {!caps.reasoning && !caps.tools && !caps.cost && !caps.steer && <span class="dim">keine besonderen Fähigkeiten gemeldet</span>}
      </div>
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
