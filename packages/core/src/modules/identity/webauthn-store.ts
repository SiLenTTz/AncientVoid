import type { HubDatabase } from "../../platform/index.ts";

/**
 * T2.5: pure persistence for WebAuthn credentials/challenges — no crypto
 * here. Verification (attestation/assertion parsing, signature checks)
 * needs the real HTTP request's rpId/origin, which is a server-package
 * concern (@simplewebauthn/server lives in packages/server); this store
 * only ever sees already-verified data or opaque challenge strings.
 */

export interface StoredCredential {
  deviceLabel: string;
  credentialId: string;
  publicKey: string; // base64url-encoded COSE public key
  counter: number;
  createdAt: string;
}

export class WebAuthnStore {
  private readonly db: HubDatabase;

  constructor(db: HubDatabase) {
    this.db = db;
  }

  getCredential(deviceLabel: string): StoredCredential | undefined {
    const row = this.db
      .prepare("SELECT * FROM webauthn_credentials WHERE device_label = ?")
      .get(deviceLabel) as unknown as
      | { device_label: string; credential_id: string; public_key: string; counter: number; created_at: string }
      | undefined;
    if (!row) return undefined;
    return {
      deviceLabel: row.device_label,
      credentialId: row.credential_id,
      publicKey: row.public_key,
      counter: row.counter,
      createdAt: row.created_at,
    };
  }

  saveCredential(cred: Omit<StoredCredential, "createdAt">): void {
    this.db
      .prepare(
        `INSERT INTO webauthn_credentials (device_label, credential_id, public_key, counter, created_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(device_label) DO UPDATE SET
           credential_id = excluded.credential_id,
           public_key = excluded.public_key,
           counter = excluded.counter`,
      )
      .run(cred.deviceLabel, cred.credentialId, cred.publicKey, cred.counter, new Date().toISOString());
  }

  updateCounter(deviceLabel: string, counter: number): void {
    this.db.prepare("UPDATE webauthn_credentials SET counter = ? WHERE device_label = ?").run(counter, deviceLabel);
  }

  /** One in-flight challenge per device — a second call for the same
   * label overwrites the first (one ceremony at a time), matching how a
   * real client only ever has one open registration/assertion prompt. */
  saveChallenge(deviceLabel: string, challenge: string, purpose: "register" | "assert"): void {
    this.db
      .prepare(
        `INSERT INTO webauthn_challenges (device_label, challenge, purpose, created_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(device_label) DO UPDATE SET challenge = excluded.challenge, purpose = excluded.purpose, created_at = excluded.created_at`,
      )
      .run(deviceLabel, challenge, purpose, new Date().toISOString());
  }

  /** Consumes (deletes) the stored challenge — a challenge is single-use
   * by construction, replay of a verify call must not succeed twice. */
  takeChallenge(deviceLabel: string, purpose: "register" | "assert"): string | undefined {
    const row = this.db
      .prepare("SELECT challenge, purpose FROM webauthn_challenges WHERE device_label = ?")
      .get(deviceLabel) as unknown as { challenge: string; purpose: string } | undefined;
    if (!row || row.purpose !== purpose) return undefined;
    this.db.prepare("DELETE FROM webauthn_challenges WHERE device_label = ?").run(deviceLabel);
    return row.challenge;
  }
}
