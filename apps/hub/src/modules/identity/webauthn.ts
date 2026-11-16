import { createHash } from "node:crypto";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import { isoBase64URL } from "@simplewebauthn/server/helpers";
import type { RegistrationResponseJSON, AuthenticationResponseJSON } from "@simplewebauthn/server";
import type { WebAuthnStore } from "@ancientvoid/core";

/**
 * T2.5 (EPIC-P2 §3): real WebAuthn registration + assertion for
 * `destructive` approvals. Uses @simplewebauthn/server rather than
 * hand-rolled CBOR/COSE/signature parsing — this is exactly the kind of
 * crypto-correctness-matters code an established, audited library exists
 * for; reimplementing it would be a real security risk for no benefit.
 *
 * rpId/origin come from HubConfig.webauthn — see its doc comment for why
 * the shipped defaults (localhost) MUST be overridden for a real Tailscale
 * deployment; WebAuthn's origin check is the whole phishing-resistance
 * point, not a formality to relax.
 */

export interface WebAuthnConfig {
  rpId: string;
  rpName: string;
  origin: string;
}

export function createWebAuthnRoutes(store: WebAuthnStore, cfg: WebAuthnConfig) {
  return {
    async registerOptions(deviceLabel: string) {
      const existing = store.getCredential(deviceLabel);
      const options = await generateRegistrationOptions({
        rpName: cfg.rpName,
        rpID: cfg.rpId,
        userName: deviceLabel,
        attestationType: "none",
        excludeCredentials: existing ? [{ id: existing.credentialId }] : [],
        authenticatorSelection: { residentKey: "preferred", userVerification: "preferred" },
      });
      store.saveChallenge(deviceLabel, options.challenge, "register");
      return options;
    },

    async registerVerify(deviceLabel: string, response: RegistrationResponseJSON): Promise<{ ok: boolean; detail?: string }> {
      const expectedChallenge = store.takeChallenge(deviceLabel, "register");
      if (!expectedChallenge) return { ok: false, detail: "no pending registration challenge for this device" };
      let verification;
      try {
        verification = await verifyRegistrationResponse({
          response,
          expectedChallenge,
          expectedOrigin: cfg.origin,
          expectedRPID: cfg.rpId,
        });
      } catch (err) {
        return { ok: false, detail: err instanceof Error ? err.message : String(err) };
      }
      if (!verification.verified || !verification.registrationInfo) {
        return { ok: false, detail: "registration verification failed" };
      }
      const { credential } = verification.registrationInfo;
      store.saveCredential({
        deviceLabel,
        credentialId: credential.id,
        publicKey: isoBase64URL.fromBuffer(credential.publicKey),
        counter: credential.counter,
      });
      return { ok: true };
    },

    async assertOptions(deviceLabel: string): Promise<{ ok: true; options: unknown } | { ok: false; detail: string }> {
      const cred = store.getCredential(deviceLabel);
      if (!cred) return { ok: false, detail: "no passkey registered for this device" };
      const options = await generateAuthenticationOptions({
        rpID: cfg.rpId,
        allowCredentials: [{ id: cred.credentialId }],
        userVerification: "required", // destructive approvals require real biometric/PIN verification, not mere presence
      });
      store.saveChallenge(deviceLabel, options.challenge, "assert");
      return { ok: true, options };
    },

    /**
     * Returns a real, verified assertion fingerprint on success — a
     * SHA-256 hash of the verified response, stored as
     * ApprovalRequest.signature (ADR-0007's honest caveat: this is an
     * audit fingerprint of an already-cryptographically-verified
     * assertion, not the raw ECDSA signature bytes, which the library
     * doesn't expose past its own verification boundary).
     */
    async assertVerify(
      deviceLabel: string,
      response: AuthenticationResponseJSON,
    ): Promise<{ ok: true; fingerprint: string } | { ok: false; detail: string }> {
      const cred = store.getCredential(deviceLabel);
      if (!cred) return { ok: false, detail: "no passkey registered for this device" };
      const expectedChallenge = store.takeChallenge(deviceLabel, "assert");
      if (!expectedChallenge) return { ok: false, detail: "no pending assertion challenge for this device" };
      let verification;
      try {
        verification = await verifyAuthenticationResponse({
          response,
          expectedChallenge,
          expectedOrigin: cfg.origin,
          expectedRPID: cfg.rpId,
          requireUserVerification: true,
          credential: {
            id: cred.credentialId,
            publicKey: isoBase64URL.toBuffer(cred.publicKey),
            counter: cred.counter,
          },
        });
      } catch (err) {
        return { ok: false, detail: err instanceof Error ? err.message : String(err) };
      }
      if (!verification.verified) return { ok: false, detail: "assertion verification failed" };
      // Clone-detection (WebAuthn spec guidance): persist the new counter
      // so a cloned authenticator replaying an old counter value fails
      // verification next time (@simplewebauthn/server itself rejects a
      // non-increasing counter inside verifyAuthenticationResponse when
      // the authenticator reports one, this just keeps our side current).
      store.updateCounter(deviceLabel, verification.authenticationInfo.newCounter);
      const fingerprint = createHash("sha256").update(JSON.stringify(response)).digest("hex");
      return { ok: true, fingerprint };
    },
  };
}
