import { DatabaseSync } from "node:sqlite";
import { chmodSync, mkdirSync } from "node:fs";
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
  {
    id: 8,
    name: "session-archived",
    sql: `ALTER TABLE sessions ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;`,
  },
  {
    id: 9,
    name: "notifications",
    sql: `
      CREATE TABLE notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        level TEXT NOT NULL,
        title TEXT NOT NULL,
        detail TEXT,
        kind TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `,
  },
  {
    id: 10,
    name: "session-title",
    sql: `ALTER TABLE sessions ADD COLUMN title TEXT;`,
  },
  {
    id: 11,
    name: "fleet",
    sql: `
      CREATE TABLE fleet_invites (
        code_hash TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        used_at TEXT,
        used_by TEXT
      );
      CREATE TABLE fleet_peers (
        host_id TEXT PRIMARY KEY,
        url TEXT NOT NULL,
        token TEXT NOT NULL,
        protocol_version INTEGER NOT NULL,
        paired_at TEXT NOT NULL
      );
    `,
  },
  {
    id: 12,
    name: "pending-operations",
    sql: `
      CREATE TABLE operations (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        payload TEXT NOT NULL,
        payload_hash TEXT NOT NULL,
        revision INTEGER NOT NULL,
        actor TEXT,
        state TEXT NOT NULL,
        outcome TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_operations_state ON operations(state);
      ALTER TABLE approvals ADD COLUMN payload_hash TEXT;
    `,
  },
  {
    id: 13,
    name: "operation-response",
    // T7.2: what the human answered (e.g. to a provider question) — kept
    // apart from the immutable, hashed payload.
    sql: `ALTER TABLE operations ADD COLUMN response TEXT;`,
  },
  {
    id: 14,
    name: "attachments",
    // T7.10 (ADR-0022): uploaded files by content hash; bytes and extracted
    // text live on disk next to them.
    sql: `
      CREATE TABLE attachments (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        bytes INTEGER NOT NULL,
        kind TEXT NOT NULL,
        created_at TEXT NOT NULL,
        extraction TEXT NOT NULL
      );
    `,
  },
  {
    id: 15,
    name: "metric-counters",
    // T7.7 (ADR-0023): per-turn evidence for tokens/cost. Older sessions
    // with a sum > 0 cannot prove every turn reported it: "partial".
    sql: `
      ALTER TABLE sessions ADD COLUMN metric_counters TEXT NOT NULL DEFAULT '{}';
      UPDATE sessions SET metric_counters = json_object(
        'turns', 1,
        'costEvents', CASE WHEN cost_usd > 0 THEN 1 ELSE 0 END,
        'tokenEvents', CASE WHEN tokens_est > 0 THEN 1 ELSE 0 END
      ) WHERE cost_usd > 0 OR tokens_est > 0;
    `,
  },
  {
    id: 16,
    name: "approval-assessment",
    // T7.9 (ADR-0024): the gatekeeper's label next to a tool approval.
    sql: `ALTER TABLE approvals ADD COLUMN assessment TEXT;`,
  },
  {
    id: 17,
    name: "session-overview-meta",
    // T8.1/T8.6: last understandable action for the card, and pins.
    sql: `
      ALTER TABLE sessions ADD COLUMN last_activity TEXT;
      ALTER TABLE sessions ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;
    `,
  },
  {
    id: 18,
    name: "drafts",
    // T8.4 (ADR-0025): one shared, revisioned draft per session.
    sql: `
      CREATE TABLE drafts (
        session_id TEXT PRIMARY KEY,
        text TEXT NOT NULL,
        attachment_ids TEXT NOT NULL,
        revision INTEGER NOT NULL,
        updated_at TEXT NOT NULL,
        device TEXT
      );
    `,
  },
  {
    id: 19,
    name: "push-subscriptions",
    // T8.3 (ADR-0026): Web Push per device — opaque ids only.
    sql: `
      CREATE TABLE push_subscriptions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        endpoint TEXT NOT NULL UNIQUE,
        p256dh TEXT NOT NULL,
        auth TEXT NOT NULL,
        device TEXT,
        created_at TEXT NOT NULL,
        quiet TEXT,
        done INTEGER NOT NULL DEFAULT 0,
        last_ok_at TEXT,
        last_error TEXT,
        last_error_at TEXT,
        gone INTEGER NOT NULL DEFAULT 0,
        last_notification_id INTEGER NOT NULL DEFAULT 0
      );
    `,
  },
  {
    id: 20,
    name: "media-jobs",
    // EPIC-P10.5 (ADR-0030): video analysis jobs; files live in data/media/<id>/.
    sql: `
      CREATE TABLE media_jobs (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        state TEXT NOT NULL
      );
    `,
  },
  {
    id: 21,
    name: "desktop-actions",
    // EPIC-P11 (ADR-0031): typing requests for the desktop companion; the
    // text column is cleared once an action ends.
    sql: `
      CREATE TABLE desktop_actions (
        id TEXT PRIMARY KEY,
        companion TEXT NOT NULL,
        created_at TEXT NOT NULL,
        state TEXT NOT NULL,
        text TEXT
      );
    `,
  },
  {
    id: 22,
    name: "session-permission-mode",
    // EPIC-P15 (ADR-0033): the permission mode a session runs in (null: the
    // adapter has none). The model already has its column.
    sql: `
      ALTER TABLE sessions ADD COLUMN permission_mode TEXT;
    `,
  },
];

export class HubDatabase {
  private readonly db: DatabaseSync;
  readonly path: string;

  constructor(path: string) {
    this.path = path;
    if (path === ":memory:") {
      this.db = new DatabaseSync(path);
      this.db.exec("PRAGMA journal_mode = WAL;");
      this.db.exec("PRAGMA foreign_keys = ON;");
      this.migrate();
      return;
    }

    // The database stores Fleet bearer credentials. New directories and the
    // SQLite files stay private without changing an existing shared parent.
    const previousUmask = process.umask(0o077);
    let db: DatabaseSync | undefined;
    try {
      const directory = dirname(resolve(path));
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      db = new DatabaseSync(path);
      this.db = db;
      this.db.exec("PRAGMA journal_mode = WAL;");
      this.db.exec("PRAGMA foreign_keys = ON;");
      chmodSync(path, 0o600);
      for (const suffix of ["-wal", "-shm"]) {
        try {
          chmodSync(`${path}${suffix}`, 0o600);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      }
      this.migrate();
    } catch (error) {
      db?.close();
      throw error;
    } finally {
      process.umask(previousUmask);
    }
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
