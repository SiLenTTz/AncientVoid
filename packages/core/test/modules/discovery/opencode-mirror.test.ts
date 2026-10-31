import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { readOpenCodeMirrorDelta } from "../../../src/modules/discovery/opencode-mirror.ts";

/** A minimal opencode store: same tables/columns the discovery scan trusts. */
function fixtureDb(dir: string) {
  const db = new DatabaseSync(join(dir, "opencode.db"));
  db.exec("CREATE TABLE session (id TEXT PRIMARY KEY, directory TEXT, title TEXT, time_created INTEGER, time_updated INTEGER)");
  db.exec("CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, time_updated INTEGER, data TEXT)");
  db.exec("CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT, time_created INTEGER, time_updated INTEGER, data TEXT)");
  return db;
}

const userMsg = (role: string) => JSON.stringify({ role });
const textPart = (text: string) => JSON.stringify({ type: "text", text });
const reasonPart = (text: string) => JSON.stringify({ type: "reasoning", text });

describe("opencode mirror reader", () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "ancientvoid-mirror-"));
    const db = fixtureDb(dir);
    db.prepare("INSERT INTO session VALUES (?,?,?,?,?)").run("ses_a", "/proj/x", "Fix the thing", 1000, 9000);
    db.prepare("INSERT INTO message VALUES (?,?,?,?,?)").run("m1", "ses_a", 1000, 1000, userMsg("user"));
    db.prepare("INSERT INTO part VALUES (?,?,?,?,?,?)").run("p1", "m1", "ses_a", 1000, 1000, textPart("Der Hub ist down"));
    db.prepare("INSERT INTO message VALUES (?,?,?,?,?)").run("m2", "ses_a", 2000, 2000, userMsg("assistant"));
    db.prepare("INSERT INTO part VALUES (?,?,?,?,?,?)").run("p2", "m2", "ses_a", 2000, 2000, reasonPart("thinking hard"));
    db.prepare("INSERT INTO part VALUES (?,?,?,?,?,?)").run("p3", "m2", "ses_a", 3000, 3000, textPart("Antwort"));
    db.prepare("INSERT INTO part VALUES (?,?,?,?,?,?)").run("p4", "m2", "ses_a", 4000, 4000, JSON.stringify({ type: "tool", tool: "bash", state: { status: "completed", input: { command: "ls" }, output: "file1" } }));
    // scaffolding parts must be ignored, not dropped loudly — they are
    // transcript noise, not chat
    db.prepare("INSERT INTO part VALUES (?,?,?,?,?,?)").run("p5", "m2", "ses_a", 5000, 5000, JSON.stringify({ type: "step-start" }));
    // a still-running tool: call visible, result only later (known limit)
    db.prepare("INSERT INTO part VALUES (?,?,?,?,?,?)").run("p6", "m2", "ses_a", 6000, 6000, JSON.stringify({ type: "tool", tool: "bash", state: { status: "running", input: { command: "sleep" } } }));
    db.close();
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("maps the conversation to hub chat events — same text, in order", () => {
    const first = readOpenCodeMirrorDelta(dir, "ses_a", 0);
    expect(first).not.toBeNull();
    expect(first!.info.title).toBe("Fix the thing");
    expect(first!.info.project).toBe("/proj/x");
    const kinds = first!.events.map((e) => e.type);
    expect(kinds).toEqual(["user", "thinking", "assistant", "tool_use", "tool_result", "tool_use"]);
    expect(first!.events[0]!.payload.text).toBe("Der Hub ist down");
    expect(first!.events[2]!.payload.text).toBe("Antwort");
    expect(first!.events[3]!.payload).toMatchObject({ tool: "bash" });
    expect(first!.events[4]!.payload).toMatchObject({ isError: false, content: "file1" });
    expect(first!.watermark).toBe(6000);
  });

  it("delta: strictly-new parts only, watermark advances", () => {
    const first = readOpenCodeMirrorDelta(dir, "ses_a", 0)!;
    const second = readOpenCodeMirrorDelta(dir, "ses_a", first.watermark)!;
    expect(second.events).toEqual([]);
    expect(second.watermark).toBe(first.watermark);
    // a late part arrives → exactly that one
    const db = new DatabaseSync(join(dir, "opencode.db"));
    db.prepare("INSERT INTO message VALUES (?,?,?,?,?)").run("m3", "ses_a", 7000, 7000, userMsg("user"));
    db.prepare("INSERT INTO part VALUES (?,?,?,?,?,?)").run("p7", "m3", "ses_a", 7000, 7000, textPart("neue Frage"));
    db.close();
    const third = readOpenCodeMirrorDelta(dir, "ses_a", first.watermark)!;
    expect(third.events.map((e) => e.type)).toEqual(["user"]);
    expect(third.events[0]!.payload.text).toBe("neue Frage");
  });

  it("unknown session or missing store → null (fail loud, not an empty chat)", () => {
    expect(readOpenCodeMirrorDelta(dir, "ses_gibtsnicht", 0)).toBeNull();
    expect(readOpenCodeMirrorDelta(join(dir, "nodir"), "ses_a", 0)).toBeNull();
  });
});
