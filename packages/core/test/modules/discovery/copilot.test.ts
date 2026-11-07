import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { scanCopilotSessions } from "../../../src/modules/discovery/copilot.ts";

/** EPIC-P35 T35.5: copilot-Store ist SQLite (~/.copilot/session-store.db), live
 * verifiziert am 07.11.2026 (copilot 1.0.104: sessions/turns, ISO-Zeiten). */
const NOW = "2026-11-07T12:00:00.000Z";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function store(): { dir: string; db: DatabaseSync } {
  const dir = mkdtempSync(join(tmpdir(), "copilot-disc-"));
  dirs.push(dir);
  const db = new DatabaseSync(join(dir, "session-store.db"));
  db.exec(`CREATE TABLE sessions (id TEXT PRIMARY KEY, cwd TEXT, repository TEXT, host_type TEXT, branch TEXT, summary TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE turns (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, turn_index INTEGER NOT NULL, user_message TEXT, assistant_response TEXT, timestamp TEXT);`);
  return { dir, db };
}

describe("Copilot-Scanner (EPIC-P35 T35.5)", () => {
  it("liefert Titel, Vorschau, Projekt und Zweig; Übernahme bleibt unbelegt (nur beobachtet)", () => {
    const { dir, db } = store();
    db.prepare("INSERT INTO sessions (id, cwd, branch, summary, created_at, updated_at) VALUES (?,?,?,?,?,?)").run(
      "290f52b9-f677-46ee-b54b-ba2b8b3d923d",
      "/work/app",
      "feat/ding",
      "Auth-Flow refactoren",
      "2026-11-06T10:00:00.000Z",
      "2026-11-06T10:05:00.000Z",
    );
    db.prepare("INSERT INTO turns (session_id, turn_index, user_message, assistant_response, timestamp) VALUES (?,?,?,?,?)").run(
      "290f52b9-f677-46ee-b54b-ba2b8b3d923d",
      0,
      "Refactore den Auth-Flow",
      "Erledigt, Tests grün.",
      "2026-11-06T10:05:00.000Z",
    );
    db.close();
    const [item] = scanCopilotSessions(dir, NOW);
    expect(item).toMatchObject({
      adapter: "copilot",
      nativeSessionId: "290f52b9-f677-46ee-b54b-ba2b8b3d923d",
      project: "/work/app",
      title: "Auth-Flow refactoren",
      preview: "Refactore den Auth-Flow",
      status: "observed",
      unsupportedResume: true,
      live: false,
    });
    expect(item!.observedAt).toBe("2026-11-06T10:05:00.000Z");
  });

  it("ohne summary wird der erste Nutzertext der Titel; /tmp-Rauschen ist temporär", () => {
    const { dir, db } = store();
    db.prepare("INSERT INTO sessions (id, cwd, created_at, updated_at) VALUES (?,?,?,?)").run("s2", "/tmp/uacc-p7/scratch", "2026-11-06T10:00:00.000Z", "2026-11-06T10:01:00.000Z");
    db.prepare("INSERT INTO turns (session_id, turn_index, user_message, timestamp) VALUES (?,?,?,?)").run("s2", 0, "Run exactly this shell command", "2026-11-06T10:01:00.000Z");
    db.close();
    const [item] = scanCopilotSessions(dir, NOW);
    expect(item).toMatchObject({ title: "Run exactly this shell command", temporary: true });
  });

  it("eben aktualisierte Sitzungen gelten als live; Wurzeln blenden fremde Projekte aus", () => {
    const { dir, db } = store();
    db.prepare("INSERT INTO sessions (id, cwd, created_at, updated_at) VALUES (?,?,?,?)").run("l1", "/work/app", "2026-11-07T11:00:00.000Z", "2026-11-07T11:59:30.000Z");
    db.prepare("INSERT INTO sessions (id, cwd, created_at, updated_at) VALUES (?,?,?,?)").run("f1", "/fremd/repo", "2026-11-07T11:00:00.000Z", "2026-11-07T11:59:30.000Z");
    db.close();
    const items = scanCopilotSessions(dir, NOW, ["/work"]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ nativeSessionId: "l1", live: true });
  });

  it("fehlender Store ist leer; ein fremdes Schema wird als unsupported-format gemeldet", () => {
    expect(scanCopilotSessions(join(tmpdir(), "copilot-gibt-es-nicht"), NOW)).toEqual([]);
    const dir = mkdtempSync(join(tmpdir(), "copilot-disc-"));
    dirs.push(dir);
    const db = new DatabaseSync(join(dir, "session-store.db"));
    db.exec("CREATE TABLE sessions (foo TEXT)");
    db.close();
    expect(scanCopilotSessions(dir, NOW)).toMatchObject([{ adapter: "copilot", status: "unsupported-format", unsupportedResume: true }]);
  });
});
