import { afterEach, describe, expect, it } from "vitest";
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, utimesSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { scanCodexSessions } from "../../../src/modules/discovery/codex.ts";
import { scanHermesSessions } from "../../../src/modules/discovery/hermes.ts";

const fixtures = fileURLToPath(new URL("../../fixtures/discovery/", import.meta.url));
const NOW = "2026-11-07T12:00:00.000Z";

describe("Codex-Scanner (EPIC-P34 T34.8)", () => {
  // Die Dateizeit der Fixtures ist die des Checkouts: ein späteres `now` hält `live` aus dem Spiel.
  const LATER = "2099-01-01T00:00:00.000Z";
  const items = scanCodexSessions(join(fixtures, "codex"), LATER);
  const byId = Object.fromEntries(items.map((i) => [i.nativeSessionId, i]));

  it("liest ID, Projekt, Titel und Vorschau aus dem Rollout; Hüllen und IDE-Kontext zählen nicht", () => {
    const a = byId["01a00000-0000-7000-8000-00000000a001"]!;
    expect(a).toMatchObject({ adapter: "codex", status: "observed", controlMode: "observed", hubSessionId: null, project: "/work/app", worktree: "feat-x", temporary: false });
    expect(a.title).toBe("Baue den Login um und teste ihn");
    expect(a.preview).toBe("Danach die Doku anpassen");
    expect(a.live).toBe(false);
  });

  it("Resume ist ohne Beleg nicht angeboten: nur beobachtet (ADR-0036)", () => {
    expect(byId["01a00000-0000-7000-8000-00000000a001"]!.unsupportedResume).toBe(true);
  });

  it("Rollouts unter /tmp sind temporär", () => {
    expect(byId["01a00000-0000-7000-8000-00000000b002"]).toMatchObject({ project: "/tmp/codex-scratch", temporary: true, title: "Reply with exactly the single word: ok" });
  });

  it("ein unbekanntes Format erscheint als unsupported-format, nie still gedroppt (Regel 6)", () => {
    const bad = items.find((i) => i.status === "unsupported-format");
    expect(bad).toMatchObject({ adapter: "codex", unsupportedResume: true });
    expect(bad!.nativeSessionId).toContain("rollout-2026-11-07T11-00-00");
  });

  it("live: nur ein eben beschriebenes Rollout; ein fehlendes Verzeichnis ist einfach leer", () => {
    const copy = mkdtempSync(join(tmpdir(), "codex-live-"));
    try {
      cpSync(join(fixtures, "codex"), copy, { recursive: true });
      const file = readdirSync(join(copy, "2026", "11", "06"))[0]!;
      const stamp = (d: Date) => utimesSync(join(copy, "2026", "11", "06", file), d, d);
      const live = () => scanCodexSessions(copy, new Date().toISOString()).find((i) => i.nativeSessionId === "01a00000-0000-7000-8000-00000000a001")!.live;
      stamp(new Date());
      expect(live()).toBe(true);
      stamp(new Date(Date.now() - 10 * 60_000));
      expect(live()).toBe(false);
    } finally {
      rmSync(copy, { recursive: true, force: true });
    }
    expect(scanCodexSessions(join(fixtures, "gibt-es-nicht"), NOW)).toEqual([]);
  });

  it("Wurzeln blenden fremde Projekte aus", () => {
    const rooted = scanCodexSessions(join(fixtures, "codex"), LATER, ["/work"]);
    expect(rooted.filter((i) => i.status === "observed").map((i) => i.nativeSessionId)).toEqual(["01a00000-0000-7000-8000-00000000a001"]);
  });
});

describe("Hermes-Scanner (EPIC-P34 T34.8)", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  function store(): { dir: string; db: DatabaseSync } {
    const dir = mkdtempSync(join(tmpdir(), "hermes-"));
    dirs.push(dir);
    const db = new DatabaseSync(join(dir, "state.db"));
    db.exec(`CREATE TABLE sessions (id TEXT PRIMARY KEY, source TEXT NOT NULL, parent_session_id TEXT, started_at REAL NOT NULL, ended_at REAL, cwd TEXT, title TEXT, last_activity_at REAL, hidden INTEGER DEFAULT 0, archived INTEGER DEFAULT 0);
      CREATE TABLE messages (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT, timestamp REAL NOT NULL);`);
    return { dir, db };
  }
  const sec = (iso: string) => Date.parse(iso) / 1000;

  it("liefert Titel, Vorschau, Projekt und Herkunft; Resume ist über hermes --resume belegt", () => {
    const { dir, db } = store();
    db.prepare("INSERT INTO sessions (id, source, started_at, ended_at, cwd, title, last_activity_at) VALUES (?,?,?,?,?,?,?)").run("20261106_231347_aaaaaa", "cli", sec("2026-11-06T23:13:47Z"), sec("2026-11-06T23:30:00Z"), "/work/app", "Akzeptanzkriterien prüfen", sec("2026-11-06T23:29:00Z"));
    db.prepare("INSERT INTO messages (session_id, role, content, timestamp) VALUES (?,?,?,?)").run("20261106_231347_aaaaaa", "user", "Prüfe die\nAC", 1);
    db.prepare("INSERT INTO messages (session_id, role, content, timestamp) VALUES (?,?,?,?)").run("20261106_231347_aaaaaa", "assistant", "Alle AC sind grün.", 2);
    db.close();
    const [item] = scanHermesSessions(dir, NOW);
    expect(item).toMatchObject({ adapter: "hermes", nativeSessionId: "20261106_231347_aaaaaa", project: "/work/app", title: "Akzeptanzkriterien prüfen", preview: "Alle AC sind grün.", status: "observed", unsupportedResume: false, live: false, temporary: false });
    expect(item!.observedAt).toBe("2026-11-06T23:29:00.000Z");
  });

  it("cron-Sessions sind temporär, Subagenten tragen ihre Eltern-ID, hidden bleibt weg", () => {
    const { dir, db } = store();
    const ins = db.prepare("INSERT INTO sessions (id, source, parent_session_id, started_at, cwd, title, hidden) VALUES (?,?,?,?,?,?,?)");
    ins.run("c1", "cron", null, 1000, "/work/app", "Nachtlauf", 0);
    ins.run("s1", "subagent", "p1", 1000, "/work/app", null, 0);
    ins.run("h1", "cli", null, 1000, "/work/app", "versteckt", 1);
    db.close();
    const byId = Object.fromEntries(scanHermesSessions(dir, NOW).map((i) => [i.nativeSessionId, i]));
    expect(byId.c1).toMatchObject({ temporary: true });
    expect(byId.s1).toMatchObject({ parentSessionId: "p1" });
    expect(byId.h1).toBeUndefined();
  });

  it("live: noch offen und eben aktiv", () => {
    const { dir, db } = store();
    db.prepare("INSERT INTO sessions (id, source, started_at, cwd, last_activity_at) VALUES (?,?,?,?,?)").run("l1", "cli", sec("2026-11-07T11:00:00Z"), "/work/app", sec("2026-11-07T11:59:30Z"));
    db.prepare("INSERT INTO sessions (id, source, started_at, ended_at, cwd, last_activity_at) VALUES (?,?,?,?,?,?)").run("l2", "cli", sec("2026-11-07T11:00:00Z"), sec("2026-11-07T11:59:40Z"), "/work/app", sec("2026-11-07T11:59:30Z"));
    db.close();
    const byId = Object.fromEntries(scanHermesSessions(dir, NOW).map((i) => [i.nativeSessionId, i]));
    expect(byId.l1!.live).toBe(true);
    expect(byId.l2!.live).toBe(false);
  });

  it("fehlender Speicher ist leer; ein fremdes Schema wird als unsupported-format gemeldet", () => {
    expect(scanHermesSessions(join(tmpdir(), "hermes-gibt-es-nicht"), NOW)).toEqual([]);
    const dir = mkdtempSync(join(tmpdir(), "hermes-"));
    dirs.push(dir);
    const db = new DatabaseSync(join(dir, "state.db"));
    db.exec("CREATE TABLE sessions (foo TEXT)");
    db.close();
    expect(scanHermesSessions(dir, NOW)).toMatchObject([{ adapter: "hermes", status: "unsupported-format", unsupportedResume: true }]);
  });
});

describe("Fixtures", () => {
  it("enthalten nichts in Form eines Geheimnisses (Muster aus scripts/capture-adapter-fixture.mjs)", () => {
    const patterns = [/(api[_-]?key|secret|password|passwd)["'\s]*[:=]["'\s]*[^"'\s]{6,}/gi, /sk-[A-Za-z0-9]{16,}/g, /\bBearer\s+[A-Za-z0-9._-]{16,}/g, /\/home\/(?!dev\b)[a-z]+/g];
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]));
    for (const file of walk(join(fixtures, "codex"))) for (const re of patterns) expect(readFileSync(file, "utf8").match(re), file).toBeNull();
  });
});
