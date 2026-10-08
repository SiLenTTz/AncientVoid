import { useEffect, useState } from "preact/hooks";
import type { ApprovalRequest, HubApi } from "../../shared/api.ts";
import { ApprovalCard } from "../approvals/Approvals.tsx";

/**
 * T7.2: what this session waits for — a tool the provider wants to run, a
 * question it asks, a prompt behind the hub gate — right above the input,
 * decided without leaving the session.
 */
export function SessionApprovals({ sessionId, api }: { sessionId: string; api: HubApi }) {
  const [items, setItems] = useState<ApprovalRequest[]>([]);
  useEffect(() => {
    let alive = true;
    // BUG-0045: ein fehlgeschlagener Abruf lässt die Karten stehen; unveränderte
    // Listen setzen keinen neuen State (kein Neuaufbau alle 2 s).
    const load = () =>
      api
        .approvals("pending")
        .then((all) => {
          if (!alive) return;
          const mine = all.filter((a) => a.sessionId === sessionId);
          setItems((prev) => (prev.length === mine.length && prev.every((p, i) => p.id === mine[i]!.id && p.status === mine[i]!.status) ? prev : mine));
        })
        .catch(() => undefined);
    void load();
    const timer = setInterval(load, 2000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [sessionId, api]);
  if (items.length === 0) return null;
  const reload = () => void api.approvals("pending").then((all) => setItems(all.filter((a) => a.sessionId === sessionId)));
  return (
    <div class="session-approvals">
      {items.map((req) => (
        <ApprovalCard key={req.id} req={req} onDecided={reload} api={api} />
      ))}
    </div>
  );
}
