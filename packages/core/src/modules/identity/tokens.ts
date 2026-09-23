import { randomBytes } from "node:crypto";
import type { HubDatabase } from "../../platform/index.ts";
import { createHash } from "node:crypto";

export interface IssuedToken {
  token: string;
  label: string;
}

/** sha256 of a raw device token — only the hash is stored. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export class TokenService {
  private readonly db: HubDatabase;

  /** The database this service lives in (fleet invites share it). */
  get database(): HubDatabase {
    return this.db;
  }

  constructor(db: HubDatabase) {
    this.db = db;
  }

  /** Issue a new device token. The plaintext is returned exactly once. */
  issue(label: string): IssuedToken {
    const token = randomBytes(24).toString("base64url");
    this.db
      .prepare("INSERT INTO device_tokens (token_hash, label, created_at) VALUES (?, ?, ?)")
      .run(hashToken(token), label, new Date().toISOString());
    return { token, label };
  }

  /** Constant-time-ish verification; updates last_used_at on success. */
  verify(token: string): boolean {
    const row = this.db
      .prepare("SELECT token_hash FROM device_tokens WHERE token_hash = ?")
      .get(hashToken(token)) as { token_hash: string } | undefined;
    if (!row) return false;
    this.db
      .prepare("UPDATE device_tokens SET last_used_at = ? WHERE token_hash = ?")
      .run(new Date().toISOString(), row.token_hash);
    return true;
  }

  /** T2.4: like `verify()`, but returns the matched token's label instead
   * of a bare boolean — used to attribute an approval decision to a real
   * device (`ApprovalRequest.decidedByLabel`) without ever persisting the
   * raw token itself. */
  identify(token: string): { label: string } | null {
    const row = this.db
      .prepare("SELECT label FROM device_tokens WHERE token_hash = ?")
      .get(hashToken(token)) as { label: string } | undefined;
    return row ?? null;
  }

  list(): { label: string; createdAt: string; lastUsedAt: string | null }[] {
    return this.db
      .prepare("SELECT label, created_at, last_used_at FROM device_tokens ORDER BY created_at")
      .all() as unknown as { label: string; createdAt: string; lastUsedAt: string | null }[];
  }

  revoke(label: string): number {
    const res = this.db.prepare("DELETE FROM device_tokens WHERE label = ?").run(label);
    return Number(res.changes);
  }
}
