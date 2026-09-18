#!/usr/bin/env node
/**
 * Messlauf (T2.9): biometric approve latency, against AC-P2-3
 * ("Biometrisches Approven eines force-push aus der Queue: Push → WebAuthn
 * → Hub-Ack in < 5 s (95. Perzentil über 20 Messungen im Test)").
 *
 * Measures through the REAL path: a real Fastify server (createHubApp)
 * serving the real built PWA, a real Chromium browser (Playwright, driving
 * this machine's system Chromium — not Playwright's own bundled browser
 * download, see CHROMIUM_PATH below), and a REAL WebAuthn ceremony via
 * Chromium's own CDP virtual authenticator (WebAuthn.addVirtualAuthenticator)
 * — a real authenticator implementation inside the browser's actual
 * WebAuthn stack, not a JS-level mock of navigator.credentials.
 *
 * "Push" is honestly out of scope for the measured window: this hub has no
 * real mobile-push infrastructure (see EPIC-P2 T2.7's own note on the same
 * gap for budget warnings) — the timed window starts where a real push
 * would hand off to the phone opening the approval, i.e. from the moment
 * the client asks for the WebAuthn assertion options, through the full
 * ceremony, to the hub's decide-response.
 *
 *   node scripts/messlauf-approve-latency.mjs [--runs 20]
 *
 * Per the messlauf skill: this script measures and prints a verdict; the
 * result of an actual run is filed under docs/messlauf/ with environment,
 * commit and command — this script alone is not the record.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const args = process.argv.slice(2);
const flag = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : def;
};
const RUNS = flag("runs", 20);

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");

// This machine's system Chromium (same technique already proven live for
// T2.5's own verification, see EPIC-P2 T2.5 evidence) — swap this for
// Playwright's bundled browser (drop `executablePath`, run `npx playwright
// install chromium` first) on a machine without a system install.
const CHROMIUM_PATH = "/usr/bin/chromium";

const { EventStore, SessionManager, AdapterRegistry, HubDatabase, TokenService, ApprovalService, WebAuthnStore } =
  await import("../packages/core/src/index.ts");
const { ProcessRunner } = await import("../packages/workers/src/process.ts");
const { createAdapter } = await import("../packages/adapter-dummy/src/index.ts");
const { createHubApp } = await import("../packages/server/src/index.ts");

const dir = await mkdtemp(join(tmpdir(), "uacc-messlauf-approve-"));
const db = new HubDatabase(":memory:");
const store = new EventStore(dir);
const registry = new AdapterRegistry();
registry.register("dummy", createAdapter, { autoStopAfterEvents: 0 });
const approvals = new ApprovalService(db, 120_000);
const webauthnStore = new WebAuthnStore(db);
const sessions = new SessionManager(db, store, registry, new ProcessRunner());
const tokens = new TokenService(db);
const { token } = tokens.issue("messlauf-device");

const PORT = 7391;
const ORIGIN = `http://localhost:${PORT}`;
const app = await createHubApp({
  sessions,
  tokens,
  registry,
  auth: { tokens, enforceTailnetIdentity: false },
  approvals,
  webauthn: { store: webauthnStore, config: { rpId: "localhost", rpName: "UACC messlauf", origin: ORIGIN } },
  pwaDir: resolve(repoRoot, "packages/pwa/dist"),
});
await app.listen({ port: PORT, host: "127.0.0.1" });
console.log(`hub listening on ${ORIGIN}`);

const record = await sessions.create({ adapter: "dummy", project: repoRoot });

const browser = await chromium.launch({ executablePath: CHROMIUM_PATH, args: ["--no-sandbox"] });
const context = await browser.newContext();
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
await cdp.send("WebAuthn.enable");
await cdp.send("WebAuthn.addVirtualAuthenticator", {
  options: {
    protocol: "ctap2",
    transport: "internal",
    hasResidentKey: true,
    hasUserVerification: true,
    isUserVerified: true,
    automaticPresenceSimulation: true,
  },
});

await page.goto(ORIGIN);
await page.evaluate((t) => localStorage.setItem("uacc.token", t), token);
await page.reload();
await page.waitForTimeout(500);
// Local UMD bundle (already a real dependency of packages/pwa, same
// library version the shipped app uses) — no network call from inside
// the measured browser context.
await page.addScriptTag({
  path: resolve(repoRoot, "node_modules/@simplewebauthn/browser/dist/bundle/index.umd.min.js"),
});

// Real passkey registration, once — a device registers a passkey once,
// not per-decision, matching the real product flow (T2.5 Settings page).
const regResult = await page.evaluate(
  async ({ origin, tok }) => {
    const optionsRes = await fetch(`${origin}/api/webauthn/register/options`, {
      method: "POST",
      headers: { authorization: `Bearer ${tok}`, "content-type": "application/json" },
      body: "{}",
    });
    const options = await optionsRes.json();
    const attestation = await window.SimpleWebAuthnBrowser.startRegistration({ optionsJSON: options });
    const verifyRes = await fetch(`${origin}/api/webauthn/register/verify`, {
      method: "POST",
      headers: { authorization: `Bearer ${tok}`, "content-type": "application/json" },
      body: JSON.stringify(attestation),
    });
    return verifyRes.json();
  },
  { origin: ORIGIN, tok: token },
);
if (!regResult.ok) {
  console.error("passkey registration failed — measurement invalid:", JSON.stringify(regResult));
  process.exit(1);
}
console.log("passkey registered");

const latenciesMs = [];
for (let i = 0; i < RUNS; i++) {
  const req = approvals.create(record.id, "destructive", "force-push", `messlauf run ${i}`);
  const t0 = process.hrtime.bigint();
  const result = await page.evaluate(
    async ({ origin, tok, approvalId }) => {
      const optionsRes = await fetch(`${origin}/api/approvals/${approvalId}/webauthn/assert-options`, {
        method: "POST",
        headers: { authorization: `Bearer ${tok}`, "content-type": "application/json" },
        body: "{}",
      });
      const options = await optionsRes.json();
      const assertion = await window.SimpleWebAuthnBrowser.startAuthentication({ optionsJSON: options });
      const decideRes = await fetch(`${origin}/api/approvals/${approvalId}/webauthn/decide`, {
        method: "POST",
        headers: { authorization: `Bearer ${tok}`, "content-type": "application/json" },
        body: JSON.stringify({ decision: "approve", reason: "messlauf", response: assertion }),
      });
      return decideRes.json();
    },
    { origin: ORIGIN, tok: token, approvalId: req.id },
  );
  const t1 = process.hrtime.bigint();
  if (result.status !== "approved") {
    console.error(`run ${i} did not approve — measurement invalid:`, JSON.stringify(result));
    process.exit(1);
  }
  latenciesMs.push(Number(t1 - t0) / 1e6);
}

await browser.close();
await app.close();
await sessions.shutdown();
await rm(dir, { recursive: true, force: true });

latenciesMs.sort((a, b) => a - b);
const n = latenciesMs.length;
const median = latenciesMs[Math.floor(n / 2)];
const p95 = latenciesMs[Math.min(n - 1, Math.floor(n * 0.95))];
const max = latenciesMs[n - 1];
const min = latenciesMs[0];

console.log(`\nbiometric approve latency — n=${n} real ceremonies`);
console.log(`  min=${min.toFixed(0)}ms  median=${median.toFixed(0)}ms  p95=${p95.toFixed(0)}ms  max=${max.toFixed(0)}ms`);
console.log(`  raw (ms): ${latenciesMs.map((v) => v.toFixed(0)).join(", ")}`);

if (p95 >= 5000) {
  console.error(`\nFAIL (AC-P2-3): p95 latency ${p95.toFixed(0)}ms >= 5000ms`);
  process.exit(1);
}
console.log(`\nPASS (AC-P2-3): p95 ${p95.toFixed(0)}ms < 5000ms over ${n} real WebAuthn ceremonies`);
