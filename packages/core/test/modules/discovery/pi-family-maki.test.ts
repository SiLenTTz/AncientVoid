import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findPiFamilySessionFile, scanMakiSessions, scanPiFamilySessions } from "../../../src/modules/discovery/index.ts";

const line = (o: unknown) => `${JSON.stringify(o)}\n`;
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), "pi-maki-"));
  dirs.push(d);
  return d;
};
const ID = "01a18324-d82d-77b4-88ff-1ab8ab9d3814";
const user = (text: string) => line({ type: "message", message: { role: "user", content: [{ type: "text", text }] } });

describe("pi und oh-my-pi (ADR-0041)", () => {
  it("pi: Titel aus der ersten Nachricht, Vorschau aus der letzten, Projekt aus cwd", () => {
    const root = tmp();
    const proj = join(root, "--tmp--");
    mkdirSync(proj, { recursive: true });
    writeFileSync(
      join(proj, `2026-10-28T10-00-00-000Z_${ID}.jsonl`),
      line({ type: "session", version: 3, id: ID, cwd: "/work/app" }) +
        line({ type: "message", message: { role: "system", content: "" } }) +
        user("Baue den Login um\nmit Tokenmaske") +
        line({ type: "message", message: { role: "assistant", content: [{ type: "text", text: "Mache ich" }] } }) +
        user("Und teste ihn bitte"),
    );
    const items = scanPiFamilySessions("pi", root, new Date().toISOString(), ["/work"]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ adapter: "pi", nativeSessionId: ID, project: "/work/app", title: "Baue den Login um", preview: "Und teste ihn bitte", status: "observed", live: true });
  });

  it("omp: der gepolsterte title-Eintrag am Anfang gewinnt; leerer Titel fällt auf die erste Nachricht zurück", () => {
    const root = tmp();
    const proj = join(root, "-work-app");
    mkdirSync(proj, { recursive: true });
    const named = "01a18324-0000-7000-8000-000000000001";
    const unnamed = "01a18324-0000-7000-8000-000000000002";
    writeFileSync(join(proj, `t_${named}.jsonl`), line({ type: "title", v: 1, title: "Importer reparieren", pad: " ".repeat(200) }) + line({ type: "session", id: named, cwd: "/work/app" }) + user("irgendwas"));
    writeFileSync(join(proj, `t_${unnamed}.jsonl`), line({ type: "title", v: 1, title: "", pad: " ".repeat(200) }) + line({ type: "session", id: unnamed, cwd: "/work/app" }) + user("Zweite Aufgabe"));
    const items = scanPiFamilySessions("omp", root, new Date().toISOString(), []);
    expect(items.find((i) => i.nativeSessionId === named)?.title).toBe("Importer reparieren");
    expect(items.find((i) => i.nativeSessionId === unnamed)?.title).toBe("Zweite Aufgabe");
    expect(items.every((i) => i.adapter === "omp")).toBe(true);
  });

  it("alte Dateien sind nicht live, fremde Projekte (außerhalb der Roots) bleiben weg, kaputte Dateien sind sichtbar", () => {
    const root = tmp();
    const proj = join(root, "--x--");
    mkdirSync(proj, { recursive: true });
    const file = join(proj, `t_${ID}.jsonl`);
    writeFileSync(file, line({ type: "session", id: ID, cwd: "/work/app" }) + user("alt"));
    const old = new Date(Date.now() - 3600_000);
    utimesSync(file, old, old);
    writeFileSync(join(proj, "kaputt.jsonl"), "kein json\n");
    writeFileSync(join(proj, "t_01a18324-0000-7000-8000-000000000009.jsonl"), line({ type: "session", id: "01a18324-0000-7000-8000-000000000009", cwd: "/anderswo/x" }));
    const items = scanPiFamilySessions("pi", root, new Date().toISOString(), ["/work"]);
    expect(items.find((i) => i.nativeSessionId === ID)?.live).toBe(false);
    expect(items.some((i) => i.project === "/anderswo/x")).toBe(false);
    expect(items.find((i) => i.status === "unsupported-format")?.nativeSessionId).toBe("unknown:kaputt.jsonl");
  });

  it("fehlender Speicher ergibt keine Zeilen, nicht lesbarer eine sichtbare", () => {
    expect(scanPiFamilySessions("pi", "/gibt/es/nicht")).toEqual([]);
  });

  it("findPiFamilySessionFile findet nur UUIDs und baut nie einen Pfad aus Fremdtext", () => {
    const root = tmp();
    const proj = join(root, "--p--");
    mkdirSync(proj, { recursive: true });
    writeFileSync(join(proj, `t_${ID}.jsonl`), "{}\n");
    expect(findPiFamilySessionFile(root, ID)).toBe(join(proj, `t_${ID}.jsonl`));
    expect(findPiFamilySessionFile(root, "../../etc/passwd")).toBeNull();
    expect(findPiFamilySessionFile(root, "01a18324-0000-7000-8000-00000000ffff")).toBeNull();
  });
});

describe("maki (ADR-0041)", () => {
  const maki = (id: string, cwd: string, title: string, messages: string[]) =>
    line({ t: "header", v: 2, id, model: "zai/glm-5.3", cwd, created_at: 1793176201 }) +
    messages.map((m) => line({ t: "msg", d: { role: "user", content: [{ type: "text", text: m }] } }) + line({ t: "msg", d: { role: "assistant", content: [{ type: "text", text: "ok" }] } })).join("") +
    line({ t: "frame", d: { system: "x".repeat(50_000) } }) +
    line({ t: "meta", title, updated_at: 1793176211 });

  it("liest Header und Meta, auch hinter einer riesigen frame-Zeile", () => {
    const root = tmp();
    writeFileSync(join(root, "CgUKcdyFc9Dg7btUis9iq.jsonl"), maki("CgUKcdyFc9Dg7btUis9iq", "/work/app", "Login umbauen", ["Erste Frage", "Letzte Frage"]));
    const items = scanMakiSessions(root, new Date().toISOString(), ["/work"]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ adapter: "maki", nativeSessionId: "CgUKcdyFc9Dg7btUis9iq", project: "/work/app", title: "Login umbauen", preview: "Letzte Frage", status: "observed" });
    expect(items[0]!.observedAt >= new Date(1793176211 * 1000).toISOString()).toBe(true);
  });

  it("ohne meta-Titel gilt die erste Nachricht; Fremdprojekte und Kaputtes verhalten sich wie bei pi", () => {
    const root = tmp();
    writeFileSync(join(root, "A.jsonl"), maki("A", "/work/app", "", ["Nur die erste"]));
    writeFileSync(join(root, "B.jsonl"), maki("B", "/fremd", "x", ["y"]));
    writeFileSync(join(root, "C.jsonl"), "kaputt\n");
    const items = scanMakiSessions(root, new Date().toISOString(), ["/work"]);
    expect(items.find((i) => i.nativeSessionId === "A")?.title).toBe("Nur die erste");
    expect(items.some((i) => i.nativeSessionId === "B")).toBe(false);
    expect(items.find((i) => i.status === "unsupported-format")?.nativeSessionId).toBe("unknown:C.jsonl");
    expect(scanMakiSessions("/gibt/es/nicht")).toEqual([]);
  });
});
