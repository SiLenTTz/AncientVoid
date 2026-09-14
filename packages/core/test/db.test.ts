import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HubDatabase } from "../src/db.ts";
import { TokenService, hashToken } from "../src/index.ts";

describe("HubDatabase", () => {
  it("runs migrations idempotently", () => {
    const db = new HubDatabase(":memory:");
    const rows = db.prepare("SELECT COUNT(*) as c FROM _migrations").all() as { c: number }[];
    expect(rows[0]!.c).toBeGreaterThan(0);
    db.close();
  });

  it("creates sessions/device_tokens/config tables", () => {
    const db = new HubDatabase(":memory:");
    for (const t of ["sessions", "device_tokens", "config"]) {
      const row = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
        .get(t) as { name: string } | undefined;
      expect(row?.name).toBe(t);
    }
    db.close();
  });

  it("migration 2 adds cost_usd and updated_at to sessions (T1.5)", () => {
    const db = new HubDatabase(":memory:");
    const columns = (db.prepare("PRAGMA table_info(sessions)").all() as { name: string }[]).map((c) => c.name);
    expect(columns).toContain("cost_usd");
    expect(columns).toContain("updated_at");
    db.close();
  });
});

describe("TokenService", () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "uacc-tok-"));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("issues tokens whose plaintext verifies exactly once-shown", () => {
    const db = new HubDatabase(":memory:");
    const tokens = new TokenService(db);
    const { token, label } = tokens.issue("pixel-9");
    expect(token.length).toBeGreaterThan(20);
    expect(tokens.verify(token)).toBe(true);
    expect(tokens.verify("wrong")).toBe(false);
    expect(tokens.list()[0]!.label).toBe(label);
    db.close();
  });

  it("stores only hashes", () => {
    const db = new HubDatabase(":memory:");
    const tokens = new TokenService(db);
    const { token } = tokens.issue("phone");
    const stored = db.prepare("SELECT token_hash FROM device_tokens").all() as { token_hash: string }[];
    expect(stored[0]!.token_hash).toBe(hashToken(token));
    expect(stored[0]!.token_hash).not.toContain(token);
    db.close();
  });

  it("revokes by label", () => {
    const db = new HubDatabase(":memory:");
    const tokens = new TokenService(db);
    tokens.issue("tablet");
    expect(tokens.revoke("tablet")).toBe(1);
    expect(tokens.revoke("tablet")).toBe(0);
    db.close();
  });
});
