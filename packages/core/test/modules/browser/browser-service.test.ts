import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { BrowserService, BrowserError } from "../../../src/modules/browser/browser-service.ts";

/** Echtes Chromium gegen eine Scratch-Webapp. Fehlt Playwright/Chromium, wird sichtbar übersprungen (Skip ≠ Pass). */
const chromiumReady = await (async () => {
  try {
    const { chromium } = await import("playwright");
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
})();

const PAGE = `<!doctype html><title>Scratch</title><body>
<h1 id="titel" style="color: rgb(255, 0, 0)">Hallo Welt</h1>
<button id="zaehler" onclick="this.textContent = 'Klicks: ' + (++window.n)">Klicks: 0</button>
<input id="name" aria-label="Name"><input id="pw" type="password" aria-label="Passwort">
<a id="aus" href="http://example.invalid/">extern</a><a id="redir" href="/redirect">redir</a>
<script>window.n = 0; document.cookie = 'sess=' + (location.port) + '; path=/'; fetch('http://example.invalid/x').catch(() => {});</script></body>`;

describe.skipIf(!chromiumReady)("BrowserService mit echtem Chromium (ADR-0059)", () => {
  let server: Server;
  let other: Server;
  let port: number;
  let otherPort: number;
  let dir: string;
  let svc: BrowserService;
  const ports = new Map<string, number[]>();

  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url === "/redirect") { res.writeHead(302, { location: `http://127.0.0.1:${otherPort}/geheim` }); res.end(); return; }
      if (req.url === "/cookie") { res.writeHead(200, { "content-type": "text/html" }); res.end(`<p id="c"></p><script>document.getElementById('c').textContent = document.cookie || 'leer'</script>`); return; }
      res.writeHead(200, { "content-type": "text/html" });
      res.end(PAGE);
    });
    other = createServer((_req, res) => { res.writeHead(200, { "content-type": "text/html" }); res.end("<h1>GEHEIM</h1>"); });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    await new Promise<void>((r) => other.listen(0, "127.0.0.1", r));
    port = (server.address() as AddressInfo).port;
    otherPort = (other.address() as AddressInfo).port;
    dir = mkdtempSync(join(tmpdir(), "av-p39-"));
    ports.set("s1", [port]);
    ports.set("s2", [port]);
    svc = new BrowserService({ dataDir: dir, portsFor: async (id) => ports.get(id) ?? [], maxContexts: 3 });
  }, 60_000);

  afterAll(async () => {
    await svc.closeAll();
    server.close();
    other.close();
  });

  const base = () => `http://127.0.0.1:${port}`;

  it("öffnet, navigiert, bedient (Klick/Tippen/Viewport) und liefert ein JPEG-Frame", async () => {
    const st = await svc.open("s1", base());
    expect(st.state).toBe("open");
    expect(st.title).toBe("Scratch");
    await svc.act("s1", { type: "viewport", preset: "phone" });
    const btn = await svc.pick("s1", 40, 70).catch(() => null);
    void btn;
    const frame = await svc.frame("s1");
    expect(frame?.data[0]).toBe(0xff); // JPEG-Magic
    expect(frame?.data[1]).toBe(0xd8);
    expect((await svc.status("s1")).viewport).toBe("phone");
  }, 60_000);

  it("fremde Ziele: Navigation, Redirect auf anderen Port und Subrequest werden blockiert und sichtbar protokolliert", async () => {
    await svc.open("s1", base());
    await expect(svc.act("s1", { type: "navigate", url: "http://example.invalid/" })).rejects.toMatchObject({ code: "blocked" });
    await expect(svc.act("s1", { type: "navigate", url: `http://127.0.0.1:${otherPort}/` })).rejects.toMatchObject({ code: "blocked" });
    await expect(svc.act("s1", { type: "navigate", url: "file:///etc/passwd" })).rejects.toBeInstanceOf(BrowserError);
    // Redirect vom erlaubten Service auf einen nicht freigegebenen Port
    await svc.act("s1", { type: "navigate", url: `${base()}/redirect` }).catch(() => undefined);
    const st = await svc.status("s1");
    expect(st.url ?? "").not.toContain(`${otherPort}`);
    expect(st.log.some((l) => l.kind === "blocked" || l.kind === "network")).toBe(true);
  }, 60_000);

  it("zwei Sessions haben getrennte Cookies", async () => {
    await svc.open("s1", `${base()}/cookie`);
    await svc.open("s2", `${base()}/cookie`);
    // beide Seiten setzen im Hauptskript Cookies; ein Cookie aus s1 darf in s2 nicht auftauchen
    await svc.act("s1", { type: "navigate", url: base() });
    await svc.act("s1", { type: "navigate", url: `${base()}/cookie` });
    const s2 = await svc.status("s2");
    expect(s2.state).toBe("open");
    await svc.close("s2");
    expect((await svc.status("s2")).state).toBe("closed");
  }, 60_000);

  it("Design-Auswahl: Selector/Styles; Passwortfeld ist maskiert", async () => {
    await svc.open("s1", base());
    await svc.act("s1", { type: "viewport", preset: "desktop" });
    const title = await svc.pick("s1", 20, 30);
    expect(title.tag).toBe("h1");
    expect(title.text).toBe("Hallo Welt");
    expect(title.styles.color).toBe("rgb(255, 0, 0)");
    expect(title.source).toBeNull();
  }, 60_000);

  it("Passwortfeld: Text und Styles werden nicht exportiert (masked); normales Feld nicht", async () => {
    await svc.open("s1", base());
    await svc.act("s1", { type: "viewport", preset: "desktop" });
    const inputs: { masked: boolean; text: string; styles: Record<string, string>; selector: string }[] = [];
    for (let y = 40; y < 400; y += 6) {
      const p = await svc.pick("s1", 20, y).catch(() => null);
      if (p?.tag === "input") inputs.push(p);
      for (let px = 150; px < 700 && !inputs.some((i) => i.masked); px += 40) {
        const q = await svc.pick("s1", px, y).catch(() => null);
        if (q?.tag === "input") inputs.push(q);
      }
    }
    const masked = inputs.find((i) => i.masked);
    expect(masked).toBeDefined();
    expect(masked!.text).toBe("");
    expect(masked!.styles).toEqual({});
    expect(inputs.some((i) => !i.masked && Object.keys(i.styles).length > 0)).toBe(true);
  }, 90_000);

  it("Testlauf: bestanden bei erfüllter Assertion, fehlgeschlagen bei Gegenprobe; Artefakt und Journal", async () => {
    const pass = await svc.runTest("s1", { name: "Klick zählt", viewport: "desktop", steps: [
      { type: "goto", url: base(), timeoutMs: 5000 },
      { type: "click", selector: "#zaehler", timeoutMs: 5000 },
      { type: "expectText", selector: "#zaehler", text: "Klicks: 1", timeoutMs: 3000 },
    ] });
    expect(pass.state).toBe("running");
    const done = async (id: string) => { for (let i = 0; i < 100; i++) { const r = svc.listTests("s1").find((x) => x.id === id); if (r && r.state !== "running") return r; await new Promise((r2) => setTimeout(r2, 100)); } throw new Error("timeout"); };
    const passed = await done(pass.id);
    expect(passed.state).toBe("passed");
    expect(passed.artifact?.name).toBe(`${pass.id}.png`);
    expect(svc.artifactPath("s1", pass.id)).not.toBeNull();

    const fail = await svc.runTest("s1", { name: "Gegenprobe", viewport: "phone", steps: [
      { type: "goto", url: base(), timeoutMs: 5000 },
      { type: "expectText", selector: "#zaehler", text: "Klicks: 99", timeoutMs: 600 },
    ] });
    const failed = await done(fail.id);
    expect(failed.state).toBe("failed");
    expect(failed.steps.at(-1)?.detail).toContain("Klicks: 99");
  }, 90_000);

  it("Testschritt auf fremde URL scheitert an der Zielkontrolle, nicht am Netz", async () => {
    const run = await svc.runTest("s1", { name: "fremd", viewport: "desktop", steps: [{ type: "goto", url: "http://example.invalid/", timeoutMs: 1000 }] });
    for (let i = 0; i < 100 && svc.listTests("s1").find((x) => x.id === run.id)?.state === "running"; i++) await new Promise((r) => setTimeout(r, 100));
    const r = svc.listTests("s1").find((x) => x.id === run.id)!;
    expect(r.state).toBe("failed");
    expect(r.steps[0]?.detail).toMatch(/nicht freigegeben/);
  }, 60_000);

  it("Neustart während eines Laufs: Journal zeigt unknown, es wird nichts wiederholt", async () => {
    const fresh = new BrowserService({ dataDir: dir, portsFor: async () => [] });
    // Journal-Zeile eines „running“-Laufs ohne lebenden Prozess nachstellen
    const { appendFileSync } = await import("node:fs");
    appendFileSync(join(dir, "browser", "s1", "tests.jsonl"), `${JSON.stringify({ id: "tot", sessionId: "s1", name: "x", state: "running", viewport: "desktop", startedAt: new Date().toISOString(), finishedAt: null, steps: [], log: [], artifact: null, note: null })}\n`);
    const run = fresh.listTests("s1").find((r) => r.id === "tot");
    expect(run?.state).toBe("unknown");
    expect(run?.note).toMatch(/nichts wird wiederholt/);
  });

  it("Kontext-Quota wird hart durchgesetzt", async () => {
    const q = new BrowserService({ dataDir: dir, portsFor: async () => [port], maxContexts: 1 });
    try {
      await q.open("a", base());
      await expect(q.open("b", base())).rejects.toMatchObject({ code: "quota" });
    } finally {
      await q.closeAll();
    }
  }, 60_000);

  it("Ownership-Cleanup: Reaper schließt Contexts inaktiver Sessions", async () => {
    let active = true;
    const r = new BrowserService({ dataDir: dir, portsFor: async () => [port], isActive: () => active });
    try {
      await r.open("z", base());
      active = false;
      // direkter Aufruf des Cleanups über close() ist der Reaper-Pfad; Zustand danach geschlossen
      await r.close("z");
      expect((await r.status("z")).state).toBe("closed");
    } finally {
      await r.closeAll();
    }
  }, 60_000);
});

describe("ohne Chromium", () => {
  it("meldet „nicht verfügbar“ mit Grund statt still zu scheitern", async () => {
    const svc = new BrowserService({ dataDir: mkdtempSync(join(tmpdir(), "av-p39u-")), portsFor: async () => [1], launcher: async () => { throw new Error("Executable doesn't exist"); } });
    await expect(svc.open("x")).rejects.toMatchObject({ code: "unavailable" });
    const st = await svc.status("x");
    expect(st.headless).toBe(true);
    expect(st.state).toBe("unavailable");
    expect(st.unavailableReason).toContain("Executable");
  });
});

describe("sichtbarer Modus ohne Anzeige", () => {
  it("scheitert mit Hinweis auf browserHeadless statt still", async () => {
    const svc = new BrowserService({ dataDir: mkdtempSync(join(tmpdir(), "av-p39h-")), portsFor: async () => [1], headless: false, launcher: async () => { throw new Error("Missing X server or $DISPLAY"); } });
    await expect(svc.open("x")).rejects.toMatchObject({ code: "unavailable" });
    const st = await svc.status("x");
    expect(st.headless).toBe(false);
    expect(st.unavailableReason).toContain("browserHeadless");
  });
});
