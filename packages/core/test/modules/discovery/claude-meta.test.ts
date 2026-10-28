import { afterEach, describe, expect, it } from "vitest";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractClaudeMeta, readClaudeMeta } from "../../../src/modules/discovery/claude-meta.ts";
import { scanClaudeSessions } from "../../../src/modules/discovery/sources.ts";

const user = (content: unknown, extra: Record<string, unknown> = {}) => ({ type: "user", message: { role: "user", content }, ...extra });
const line = (o: unknown) => `${JSON.stringify(o)}\n`;

describe("extractClaudeMeta (ADR-0040)", () => {
  it("nimmt ai-title und last-prompt, wenn Claude sie geschrieben hat", () => {
    const meta = extractClaudeMeta(
      [user("Erste Frage")],
      [{ type: "ai-title", aiTitle: "Mobile-hub Session-Abbrüche" }, { type: "last-prompt", lastPrompt: "Mach\n deine   Empfehlung" }],
    );
    expect(meta).toEqual({ title: "Mobile-hub Session-Abbrüche", preview: "Mach deine Empfehlung" });
  });

  it("fällt ohne ai-title auf den ersten echten Prompt zurück und überspringt CLI-Hüllen", () => {
    const meta = extractClaudeMeta(
      [user("<command-name>/clear</command-name>"), user("Caveat: The messages below", {}), user("kontext", { isMeta: true }), user([{ type: "text", text: "Baue den Login um\nund teste ihn" }])],
      [],
    );
    expect(meta.title).toBe("Baue den Login um");
  });

  it("Tool-Ergebnisse und Subagent-Turns sind keine Nutzereingabe", () => {
    const meta = extractClaudeMeta([user([{ type: "tool_result", content: "x" }]), user("intern", { isSidechain: true })], []);
    expect(meta).toEqual({ title: null, preview: null });
  });

  it("kürzt Titel auf 80 und Vorschau auf 160 Zeichen", () => {
    const meta = extractClaudeMeta([], [{ type: "ai-title", aiTitle: "t".repeat(200) }, { type: "last-prompt", lastPrompt: "p".repeat(500) }]);
    expect(meta.title).toHaveLength(80);
    expect(meta.preview).toHaveLength(160);
  });
});

describe("readClaudeMeta und Scan", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  const tmp = () => {
    const d = mkdtempSync(join(tmpdir(), "claude-meta-"));
    dirs.push(d);
    return d;
  };

  it("liest nur Kopf und Ende: ein großes Transkript liefert den Titel vom Ende", () => {
    const file = join(tmp(), "s.jsonl");
    const filler = line(user("füller ".repeat(200)));
    writeFileSync(file, line(user("Allererste Frage")) + filler.repeat(2500) + line({ type: "ai-title", aiTitle: "Titel am Ende" }) + line({ type: "last-prompt", lastPrompt: "Letztes Wort" }));
    expect(statSync(file).size).toBeGreaterThan(600 * 1024);
    expect(readClaudeMeta(file, statSync(file))).toEqual({ title: "Titel am Ende", preview: "Letztes Wort" });
  });

  it("merkt sich das Ergebnis je Dateiversion und liest bei Änderung neu", () => {
    const file = join(tmp(), "s.jsonl");
    writeFileSync(file, line({ type: "ai-title", aiTitle: "Alt" }));
    expect(readClaudeMeta(file, statSync(file)).title).toBe("Alt");
    appendFileSync(file, line({ type: "ai-title", aiTitle: "Neu" }));
    expect(readClaudeMeta(file, statSync(file)).title).toBe("Neu");
  });

  it("eine kaputte Zeile im Fenster verhindert den Titel nicht", () => {
    const file = join(tmp(), "s.jsonl");
    writeFileSync(file, `{kaputt\n${line({ type: "ai-title", aiTitle: "Trotzdem" })}`);
    expect(readClaudeMeta(file, statSync(file)).title).toBe("Trotzdem");
  });

  it("scanClaudeSessions liefert Titel, Vorschau und live (frisch geschrieben) je Session", () => {
    const claudeDir = tmp();
    const proj = join(claudeDir, "projects", "-tmp-p");
    mkdirSync(proj, { recursive: true });
    writeFileSync(join(proj, "frisch.jsonl"), line({ type: "ai-title", aiTitle: "Frisch" }));
    const items = scanClaudeSessions(claudeDir, new Date().toISOString(), ["/tmp/p"]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ nativeSessionId: "frisch", title: "Frisch", live: true });
    const later = scanClaudeSessions(claudeDir, new Date(Date.now() + 10 * 60_000).toISOString(), ["/tmp/p"]);
    expect(later[0]!.live).toBe(false);
  });
});
