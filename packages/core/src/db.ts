import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

/**
 * SQLite persistence for sessions, device tokens and config KV.
 * JSONL remains the source of truth for events (ADR-P0-2); SQLite holds
 * indices and mutable state only.
 */

export interface Migration {
  id: number;
  name: string;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  {
    id: 1,
    name: "initial-schema",
    sql: `
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        adapter TEXT NOT NULL,
        project TEXT NOT NULL,
        worktree_sha TEXT,
        model TEXT,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        budget_usd REAL,
        adapter_version TEXT NOT NULL,
        last_seq INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
      CREATE INDEX IF NOT EXISTS idx_sessions_adapter ON sessions(adapter);

      CREATE TABLE IF NOT EXISTS device_tokens (
        token_hash TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        created_at TEXT NOT NULL,
        last_used_at TEXT
      );

      CREATE TABLE IF NOT EXISTS config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `,
  },
  {
    id: 2,
    name: "sessions-cost-and-activity",
    sql: `
      ALTER TABLE sessions ADD COLUMN cost_usd REAL NOT NULL DEFAULT 0;
      ALTER TABLE sessions ADD COLUMN updated_at TEXT NOT NULL DEFAULT '';
      UPDATE sessions SET updated_at = created_at WHERE updated_at = '';
      CREATE INDEX IF NOT EXISTS idx_sessions_updated_at ON sessions(updated_at);
    `,
  },
  {
    id: 3,
    name: "sessions-tokens-est",
    sql: `
      ALTER TABLE sessions ADD COLUMN tokens_est INTEGER NOT NULL DEFAULT 0;
    `,
  },
  {
    id: 4,
    name: "approval-queue",
    sql: `
      CREATE TABLE IF NOT EXISTS approvals (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        class TEXT NOT NULL,
        action TEXT NOT NULL,
        summary TEXT NOT NULL,
        created_at TEXT NOT NULL,
        timeout_at TEXT NOT NULL,
        status TEXT NOT NULL,
        reason_required INTEGER NOT NULL DEFAULT 0,
        reason TEXT,
        decided_at TEXT,
        decided_by_label TEXT,
        signature TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_approvals_status ON approvals(status);
      CREATE INDEX IF NOT EXISTS idx_approvals_session ON approvals(session_id);
    `,
  },
  {
    id: 5,
    name: "webauthn-credentials",
    sql: `
      CREATE TABLE IF NOT EXISTS webauthn_credentials (
        device_label TEXT PRIMARY KEY,
        credential_id TEXT NOT NULL,
        public_key TEXT NOT NULL,
        counter INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS webauthn_challenges (
        device_label TEXT PRIMARY KEY,
        challenge TEXT NOT NULL,
        purpose TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `,
  },
  {
    id: 6,
    name: "session-park-reason",
    sql: `
      ALTER TABLE sessions ADD COLUMN park_reason TEXT;
    `,
  },
  {
    id: 7,
    name: "session-identity",
    sql: `
      ALTER TABLE sessions ADD COLUMN control_mode TEXT NOT NULL DEFAULT 'managed';
      ALTER TABLE sessions ADD COLUMN harness TEXT NOT NULL DEFAULT 'cli';
      ALTER TABLE sessions ADD COLUMN host_id TEXT NOT NULL DEFAULT 'local';
      ALTER TABLE sessions ADD COLUMN native_session_id TEXT;
      ALTER TABLE sessions ADD COLUMN resume_version INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE sessions ADD COLUMN log_offset INTEGER;
      ALTER TABLE sessions ADD COLUMN parent_session_id TEXT;
      ALTER TABLE sessions ADD COLUMN observed_at TEXT;
      ALTER TABLE sessions ADD COLUMN fork INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE sessions ADD COLUMN input_revision INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE sessions ADD COLUMN writer_client TEXT;
      ALTER TABLE sessions ADD COLUMN writer_lease_until TEXT;
      CREATE TABLE IF NOT EXISTS session_inputs (
        session_id TEXT NOT NULL,
        input_id TEXT NOT NULL,
        applied_at TEXT NOT NULL,
        PRIMARY KEY (session_id, input_id)
      );
    `,
  },
];

export class HubDatabase {
  private readonly db: DatabaseSync;
  readonly path: string;

  constructor(path: string) {
    this.path = path;
    if (path !== ":memory:") {
      mkdirSync(dirname(resolve(path)), { recursive: true });
    }
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS _migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)",
    );
    const applied = new Set(
      (
        this.db.prepare("SELECT id FROM _migrations").all() as { id: number }[]
      ).map((r) => r.id),
    );
    for (const m of MIGRATIONS) {
      if (applied.has(m.id)) continue;
      this.db.exec("BEGIN");
      try {
        this.db.exec(m.sql);
        this.db
          .prepare("INSERT INTO _migrations (id, name, applied_at) VALUES (?, ?, ?)")
          .run(m.id, m.name, new Date().toISOString());
        this.db.exec("COMMIT");
      } catch (err) {
        this.db.exec("ROLLBACK");
        throw err;
      }
    }
  }

  prepare(sql: string) {
    return this.db.prepare(sql);
  }

  close(): void {
    this.db.close();
  }
}
