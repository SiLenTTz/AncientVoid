import { createHash, randomInt } from "node:crypto";
import type { FleetPeerView } from "@ancientvoid/contracts";
import { FLEET_TOKEN_PREFIX } from "@ancientvoid/contracts";
import type { HubDatabase } from "../../platform/index.ts";
import type { TokenService } from "../identity/index.ts";

/** No 0/O/1/I — the code is read off one screen and typed on another. */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const DEFAULT_INVITE_TTL_MS = 10 * 60_000;

function hashCode(code: string): string {
  return createHash("sha256").update(normalizeCode(code)).digest("hex");
}

export function normalizeCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export interface FleetPeer extends FleetPeerView {
  token: string;
}

/**
 * T6.2 / ADR-0017: invites this hub hands out, and the peers it paired with.
 * Peer tokens live only here (the hub's data directory), never in a URL.
 */
export class FleetStore {
  private readonly db: HubDatabase;
  private readonly tokens: TokenService;

  constructor(db: HubDatabase, tokens: TokenService) {
    this.db = db;
    this.tokens = tokens;
  }

  createInvite(ttlMs = DEFAULT_INVITE_TTL_MS, now = new Date()): { code: string; expiresAt: string } {
    const raw = Array.from({ length: 12 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");
    const code = `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8)}`;
    const expiresAt = new Date(now.getTime() + ttlMs).toISOString();
    this.db
      .prepare("INSERT INTO fleet_invites (code_hash, created_at, expires_at) VALUES (?, ?, ?)")
      .run(hashCode(code), now.toISOString(), expiresAt);
    return { code, expiresAt };
  }

  /** One use, before it expires. Returns a token bound to the home hub. */
  redeem(code: string, homeHostId: string, now = new Date()): { token: string } | { error: string } {
    const row = this.db
      .prepare("SELECT expires_at, used_at FROM fleet_invites WHERE code_hash = ?")
      .get(hashCode(code)) as { expires_at: string; used_at: string | null } | undefined;
    if (!row) return { error: "unknown code" };
    if (row.used_at) return { error: "code already used" };
    if (Date.parse(row.expires_at) < now.getTime()) return { error: "code expired" };
    this.db
      .prepare("UPDATE fleet_invites SET used_at = ?, used_by = ? WHERE code_hash = ?")
      .run(now.toISOString(), homeHostId, hashCode(code));
    const label = `${FLEET_TOKEN_PREFIX}${homeHostId}`;
    this.tokens.revoke(label);
    return { token: this.tokens.issue(label).token };
  }

  savePeer(peer: FleetPeer): void {
    this.db
      .prepare(
        `INSERT INTO fleet_peers (host_id, url, token, protocol_version, paired_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(host_id) DO UPDATE SET url = excluded.url, token = excluded.token,
           protocol_version = excluded.protocol_version, paired_at = excluded.paired_at`,
      )
      .run(peer.hostId, peer.url, peer.token, peer.protocolVersion, peer.pairedAt);
  }

  peer(hostId: string): FleetPeer | null {
    const row = this.db.prepare("SELECT * FROM fleet_peers WHERE host_id = ?").get(hostId) as PeerRow | undefined;
    return row ? toPeer(row) : null;
  }

  peers(): FleetPeer[] {
    return (this.db.prepare("SELECT * FROM fleet_peers ORDER BY host_id").all() as unknown as PeerRow[]).map(toPeer);
  }

  removePeer(hostId: string): boolean {
    return Number(this.db.prepare("DELETE FROM fleet_peers WHERE host_id = ?").run(hostId).changes) > 0;
  }
}

interface PeerRow {
  host_id: string;
  url: string;
  token: string;
  protocol_version: number;
  paired_at: string;
}

function toPeer(row: PeerRow): FleetPeer {
  return { hostId: row.host_id, url: row.url, token: row.token, protocolVersion: row.protocol_version, pairedAt: row.paired_at };
}

export function peerView(peer: FleetPeer): FleetPeerView {
  return { hostId: peer.hostId, url: peer.url, protocolVersion: peer.protocolVersion, pairedAt: peer.pairedAt };
}
