import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { promisify } from "node:util";
import type { WorkspaceBaseline } from "@ancientvoid/contracts";
import type { HubDatabase } from "../../platform/index.ts";

const execFileAsync = promisify(execFile);
const MAX_DIRTY = 200;

const git = async (cwd: string, ...args: string[]): Promise<string | null> =>
  execFileAsync("git", ["-C", cwd, ...args], { maxBuffer: 4 * 1024 * 1024 }).then((r) => r.stdout, () => null);

/**
 * ADR-0057 §3: kanonische Checkout-Identität. Symlinks und Unterordner führen
 * auf denselben Schlüssel: realpath der Git-Toplevel-Ebene (Nicht-Git: realpath
 * des Ordners). Ein zweiter Worktree desselben Repos ist ein eigener Checkout.
 */
export async function canonicalCheckout(project: string): Promise<{ checkoutId: string; isGit: boolean }> {
  const real = await realpath(project);
  const top = (await git(real, "rev-parse", "--show-toplevel"))?.trim();
  if (!top) return { checkoutId: real, isGit: false };
  return { checkoutId: await realpath(top), isGit: true };
}

/** Zustand des Checkouts jetzt — Grundlage von Dirty-Bestätigung, Baseline und Drift. */
export async function checkoutState(checkoutId: string): Promise<Omit<WorkspaceBaseline, "checkoutId"> & { isGit: boolean }> {
  const head = (await git(checkoutId, "rev-parse", "HEAD"))?.trim() ?? null;
  if (head === null) return { isGit: false, head: null, branch: null, dirty: [], dirtyTruncated: false };
  const branch = (await git(checkoutId, "symbolic-ref", "--short", "-q", "HEAD"))?.trim() || null;
  const status = (await git(checkoutId, "status", "--porcelain", "-z", "--untracked-files=all")) ?? "";
  const entries = status.split("\0").filter(Boolean).map((e) => e.slice(3));
  return { isGit: true, head, branch, dirty: entries.slice(0, MAX_DIRTY), dirtyTruncated: entries.length > MAX_DIRTY };
}

export interface CheckoutLease {
  checkoutId: string;
  sessionId: string;
  generation: number;
  acquiredAt: string;
}

/**
 * ADR-0057 §3: höchstens ein AV-Schreiber pro direktem Checkout. Die Lease
 * liegt in SQLite (überlebt SIGKILL, K7); ein Eigentümer, der nicht mehr aktiv
 * ist, wird beim nächsten Erwerb mit höherer Generation abgelöst — nie still
 * geteilt. Externe Editoren/CLIs sind damit nicht gesperrt (nur AV-intern).
 */
export class CheckoutLeaseStore {
  private readonly db: HubDatabase;

  constructor(db: HubDatabase) {
    this.db = db;
  }

  get(checkoutId: string): CheckoutLease | null {
    const row = this.db.prepare("SELECT * FROM checkout_leases WHERE checkout_id = ?").get(checkoutId) as
      | { checkout_id: string; session_id: string; generation: number; acquired_at: string }
      | undefined;
    return row && row.session_id !== "" ? { checkoutId: row.checkout_id, sessionId: row.session_id, generation: row.generation, acquiredAt: row.acquired_at } : null;
  }

  /** `isActive` entscheidet, ob der bisherige Eigentümer noch schreiben darf (Recovery vor Freigabe). */
  acquire(
    checkoutId: string,
    sessionId: string,
    isActive: (ownerSessionId: string) => boolean,
  ): { ok: true; generation: number } | { ok: false; ownerSessionId: string } {
    const held = this.get(checkoutId);
    if (held && held.sessionId !== sessionId && isActive(held.sessionId)) return { ok: false, ownerSessionId: held.sessionId };
    const raw = this.db.prepare("SELECT generation FROM checkout_leases WHERE checkout_id = ?").get(checkoutId) as { generation: number } | undefined;
    const generation = (raw?.generation ?? 0) + 1;
    this.db
      .prepare(
        `INSERT INTO checkout_leases (checkout_id, session_id, generation, acquired_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(checkout_id) DO UPDATE SET session_id = excluded.session_id, generation = excluded.generation, acquired_at = excluded.acquired_at`,
      )
      .run(checkoutId, sessionId, generation, new Date().toISOString());
    return { ok: true, generation };
  }

  /** Gibt nur die eigene Lease frei — eine inzwischen übernommene bleibt unberührt.
   * Die Zeile bleibt als Tombstone, damit die Generation monoton weiterzählt.
   * ADR-0077: Mit-Nutzerschaft (Nicht-Git-Ordner) endet mit derselben Session. */
  release(sessionId: string): void {
    this.db.prepare("UPDATE checkout_leases SET session_id = '' WHERE session_id = ?").run(sessionId);
    this.db.prepare("DELETE FROM checkout_tenants WHERE session_id = ?").run(sessionId);
  }

  /** ADR-0081: wer schreibt hier noch mit? Primärer Lease-Inhaber + Mit-Nutzer,
   * ohne die fragliche Session selbst. `isActive` filtert tote Sessions —
   * sonst erzwingt die Preview eine Überschreib-Bestätigung ohne Gegenüber. */
  holders(checkoutId: string, exceptSessionId?: string, isActive: (sessionId: string) => boolean = () => true): string[] {
    const out: string[] = [];
    const primary = this.get(checkoutId);
    if (primary && primary.sessionId !== exceptSessionId && isActive(primary.sessionId)) out.push(primary.sessionId);
    const rows = this.db
      .prepare("SELECT session_id FROM checkout_tenants WHERE checkout_id = ? AND session_id <> ?")
      .all(checkoutId, exceptSessionId ?? "") as { session_id: string }[];
    for (const r of rows) if (r.session_id !== primary?.sessionId && isActive(r.session_id)) out.push(r.session_id);
    return out;
  }

  /** ADR-0077: Mit-Nutzerschaft eines Nicht-Git-Ordners — ausdrückliche Bestätigung
   * muss der Aufrufer getragen haben; der Store prüft das nicht erneut. */
  addTenant(checkoutId: string, sessionId: string): void {
    this.db
      .prepare("INSERT INTO checkout_tenants (checkout_id, session_id, acquired_at) VALUES (?, ?, ?) ON CONFLICT(checkout_id, session_id) DO NOTHING")
      .run(checkoutId, sessionId, new Date().toISOString());
  }

  isTenant(checkoutId: string, sessionId: string): boolean {
    return this.db
      .prepare("SELECT 1 AS hit FROM checkout_tenants WHERE checkout_id = ? AND session_id = ?")
      .get(checkoutId, sessionId) !== undefined;
  }
}
