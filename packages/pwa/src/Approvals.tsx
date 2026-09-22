import { useEffect, useState } from "preact/hooks";
import { hubApi, type ApprovalRequest } from "./api.ts";
import { startAuthentication } from "@simplewebauthn/browser";
import type { PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/browser";

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

  // T2.5: the real biometric path for destructive approvals — a fresh
  // WebAuthn assertion ceremony per decision, never a cached/reused one.
  const decideBiometric = async (decision: "approve" | "reject") => {
    setBusy(true);
    setError("");
    try {
      const options = (await hubApi.webauthnAssertOptions(req.id)) as PublicKeyCredentialRequestOptionsJSON;
      const assertion = await startAuthentication({ optionsJSON: options });
      await hubApi.decideApprovalBiometric(req.id, decision, assertion, reason || undefined);
      onDecided();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Biometrische Freigabe fehlgeschlagen");
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

      {pending && (
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
            {destructive ? (
              <>
                <button
                  class={busy ? "btn primary busy" : "btn primary"}
                  aria-busy={busy}
                  disabled={busy || (req.reasonRequired && !reason.trim())}
                  onClick={() => decideBiometric("approve")}
                >
                  {busy ? "lädt…" : "🔒 Mit Passkey freigeben"}
                </button>
                <button class={busy ? "btn danger busy" : "btn danger"} aria-busy={busy} disabled={busy} onClick={() => decideBiometric("reject")}>
                  {busy ? "lädt…" : "Ablehnen"}
                </button>
              </>
            ) : (
              <>
                <button
                  class={busy ? "btn primary busy" : "btn primary"}
                  aria-busy={busy}
                  disabled={busy || (req.reasonRequired && !reason.trim())}
                  onClick={() => decide("approve")}
                >
                  {busy ? "lädt…" : "Freigeben"}
                </button>
                <button class={busy ? "btn danger busy" : "btn danger"} aria-busy={busy} disabled={busy} onClick={() => decide("reject")}>
                  {busy ? "lädt…" : "Ablehnen"}
                </button>
              </>
            )}
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
