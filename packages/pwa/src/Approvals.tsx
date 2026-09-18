import { useEffect, useState } from "preact/hooks";
import { hubApi, type ApprovalRequest } from "./api.ts";

/**
 * T2.6 (EPIC-P2 §4 "Approval-Queue (S4) mit Zeit-schleifen-Gruppierung und
 * Risiko-Badges"): a global inbox for every pending write/destructive
 * decision (ADR-0007), reached from the Dashboard's pending-count banner.
 *
 * Grouping is time-based ("Zeit…-Gruppierung"): what still needs a
 * decision right now vs. what was already decided, bucketed by how
 * recently — a reviewer cares about "what's live" far more than a flat
 * chronological list.
 */

function secondsLeft(timeoutAt: string): number {
  return Math.max(0, Math.round((new Date(timeoutAt).getTime() - Date.now()) / 1000));
}

function riskBadge(cls: ApprovalRequest["class"]) {
  if (cls === "destructive") return <span class="badge risk-destructive">destruktiv · Biometrie</span>;
  return <span class="badge risk-write">Bestätigung</span>;
}

function ApprovalCard({ req, onDecided }: { req: ApprovalRequest; onDecided: () => void }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = req.status === "pending";
  const destructive = req.class === "destructive";

  const decide = async (decision: "approve" | "reject") => {
    setBusy(true);
    setError("");
    try {
      await hubApi.decideApproval(req.id, decision, reason || undefined);
      onDecided();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Entscheidung fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="card approval-card">
      <div class="approval-card-head">
        {riskBadge(req.class)}
        {pending && <span class="approval-countdown mono">läuft ab in {secondsLeft(req.timeoutAt)}s</span>}
        {!pending && <span class={`badge status-${req.status}`}>{req.status}</span>}
      </div>
      <div class="approval-summary">{req.summary}</div>
      <div class="dim" style="font-size: 11px">
        Session {req.sessionId.slice(0, 8)} · {req.action}
      </div>

      {pending && destructive && (
        <div class="dim" style="font-size: 12px; margin-top: 6px">
          Erfordert WebAuthn-Biometrie (T2.5) — noch nicht verfügbar, kann hier noch nicht entschieden werden.
        </div>
      )}

      {pending && !destructive && (
        <>
          {req.reasonRequired && (
            <textarea
              class="approval-reason"
              placeholder="Begründung (Pflicht)…"
              value={reason}
              onInput={(e) => setReason((e.target as HTMLTextAreaElement).value)}
            />
          )}
          {error && <div style="color: var(--err); font-size: 12px">{error}</div>}
          <div class="approval-actions">
            <button
              class="btn primary"
              disabled={busy || (req.reasonRequired && !reason.trim())}
              onClick={() => decide("approve")}
            >
              Freigeben
            </button>
            <button class="btn danger" disabled={busy} onClick={() => decide("reject")}>
              Ablehnen
            </button>
          </div>
        </>
      )}

      {!pending && req.reason && <div class="dim" style="font-size: 11px; margin-top: 4px">Begründung: {req.reason}</div>}
      {!pending && req.decidedByLabel && (
        <div class="dim" style="font-size: 11px">
          entschieden von {req.decidedByLabel} · signiert {req.signature ? "✓" : "—"}
        </div>
      )}
    </div>
  );
}

export function ApprovalQueuePane() {
  const [items, setItems] = useState<ApprovalRequest[] | null>(null);
  const [unsupported, setUnsupported] = useState(false);

  const reload = () => {
    hubApi
      .approvals()
      .then((res) => setItems(res))
      .catch((err) => {
        // A hub without ApprovalService configured answers 501 — an
        // honest "this hub doesn't have this feature on", not a broken load.
        if (err instanceof Error && err.message.includes("501")) setUnsupported(true);
        setItems([]);
      });
  };

  useEffect(() => {
    reload();
    const timer = setInterval(reload, 3000);
    return () => clearInterval(timer);
  }, []);

  if (unsupported) {
    return <div class="empty">Freigabe-Warteschlange ist auf diesem Hub nicht konfiguriert.</div>;
  }
  if (items === null) return <div class="empty">lädt …</div>;

  const now = Date.now();
  const pending = items.filter((i) => i.status === "pending");
  const recent = items.filter((i) => i.status !== "pending" && i.decidedAt && now - new Date(i.decidedAt).getTime() < 10 * 60_000);
  const older = items.filter((i) => !pending.includes(i) && !recent.includes(i)).slice(0, 20);

  return (
    <div>
      <h2 class="approval-group-heading">Wartet auf dich ({pending.length})</h2>
      {pending.length === 0 ? (
        <div class="empty">keine offenen Freigaben</div>
      ) : (
        pending.map((r) => <ApprovalCard key={r.id} req={r} onDecided={reload} />)
      )}

      {recent.length > 0 && (
        <>
          <h2 class="approval-group-heading">Kürzlich entschieden</h2>
          {recent.map((r) => (
            <ApprovalCard key={r.id} req={r} onDecided={reload} />
          ))}
        </>
      )}

      {older.length > 0 && (
        <>
          <h2 class="approval-group-heading">Älter</h2>
          {older.map((r) => (
            <ApprovalCard key={r.id} req={r} onDecided={reload} />
          ))}
        </>
      )}
    </div>
  );
}
