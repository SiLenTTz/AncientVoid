#!/usr/bin/env node
/* global fetch, URL */
// EPIC-P11 / T11.5: the desktop companion on a real Wayland compositor —
// never on the person's own desktop. A headless sway (unpacked without
// root, see docs/desktop-companion.md) in its own XDG_RUNTIME_DIR; real
// wtype, real apps (foot, a GTK3 field, Chromium), the real companion and
// hub code (apps: foot, GTK4, Chromium; GTK3 as its own cell). Measures AC-P11-1 (3 apps × 10 flows), the focus race,
// AC-P11-3 (local stop) and the password refusal (AC-P11-4).
//
//   node scripts/messlauf-desktop.mjs [out.json]
// Env: ANCIENTVOID_SWAY_LAB (default ~/ancientvoid-companion-lab: usr/bin/sway, usr/lib)
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, chmodSync, existsSync } from "node:fs";
import { createServer } from "node:http";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { AdapterRegistry, DesktopService, EventStore, HubDatabase, SessionManager, TokenService } from "../packages/core/src/index.ts";
import { ProcessRunner } from "../packages/workers/src/index.ts";
import { createHubApp } from "../apps/hub/src/app.ts";
import { Companion, SwayBackend, WtypeInput, atspiRole, exec } from "../apps/companion/src/companion.ts";
import { sendControl, serveControl } from "../apps/companion/src/control.ts";

const out = process.argv[2] ?? join(tmpdir(), "messlauf-desktop.json");
const LAB = process.env.ANCIENTVOID_SWAY_LAB ?? join(homedir(), "ancientvoid-companion-lab");
if (!existsSync(join(LAB, "usr/bin/sway"))) throw new Error(`kein sway unter ${LAB}`);
const repo = new URL("..", import.meta.url).pathname;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- an isolated compositor: nothing here reaches the person's desktop ----
const rt = mkdtempSync(join(tmpdir(), "ancientvoid-wl-"));
chmodSync(rt, 0o700);
for (const k of ["WAYLAND_DISPLAY", "DISPLAY", "HYPRLAND_INSTANCE_SIGNATURE", "SWAYSOCK"]) delete process.env[k];
process.env.XDG_RUNTIME_DIR = rt;
writeFileSync(join(rt, "sway.conf"), "output HEADLESS-1 resolution 1280x720\ndefault_border none\nxwayland disable\nfocus_on_window_activation focus\n");
const sway = spawn(join(LAB, "usr/bin/sway"), ["-c", join(rt, "sway.conf")], { env: { ...process.env, WLR_BACKENDS: "headless", WLR_LIBINPUT_NO_DEVICES: "1", WLR_RENDERER: "pixman", LD_LIBRARY_PATH: join(LAB, "usr/lib") }, stdio: "ignore" });
await sleep(1500);
process.env.WAYLAND_DISPLAY = "wayland-1";
process.env.SWAYSOCK = execFileSync("sh", ["-c", `ls ${rt}/sway-ipc.*`], { encoding: "utf8" }).trim();
const swaymsg = async (...args) => exec(join(LAB, "usr/bin/swaymsg"), args);
process.env.LD_LIBRARY_PATH = join(LAB, "usr/lib"); // swaymsg needs it; the apps don't mind
const children = [sway];

async function focused() {
  const tree = JSON.parse(await swaymsg("-t", "get_tree"));
  const find = (n) => (n.focused && n.app_id !== undefined ? n : [...(n.nodes ?? []), ...(n.floating_nodes ?? [])].map(find).find(Boolean) ?? null);
  return find(tree);
}
async function waitFocus(pred, what) {
  for (let i = 0; i < 100; i++) {
    const f = await focused().catch(() => null);
    if (f && pred(f)) return f;
    await sleep(100);
  }
  throw new Error(`Fenster erschien nicht: ${what}`);
}
async function focusOn(conId) {
  await swaymsg(`[con_id=${conId}]`, "focus");
  await waitFocus((f) => f.id === conId, `con ${conId}`);
}

// ---- apps ---------------------------------------------------------------
const lines = new Map(); // app → received lines
function collect(name, stream) {
  lines.set(name, []);
  let buf = "";
  stream.setEncoding("utf8");
  stream.on("data", (d) => {
    buf += d;
    const parts = buf.split("\n");
    buf = parts.pop();
    for (const p of parts) lines.get(name).push(p);
  });
}
async function startGtk(name, title, extra = []) {
  const p = spawn("python3", ["-u", join(repo, "scripts/desktop-lab/entry.py"), title, ...extra], { env: { ...process.env, GDK_BACKEND: "wayland", GSK_RENDERER: "cairo" }, stdio: ["ignore", "pipe", "ignore"] });
  children.push(p);
  collect(name, p.stdout);
  return waitFocus((f) => f.name === title, title);
}
async function startFoot(name) {
  const file = join(rt, `${name}.txt`);
  writeFileSync(file, "");
  const p = spawn("foot", ["--app-id", name, "sh", "-c", `stty -echo; cat >> ${file}`], { stdio: "ignore" });
  children.push(p);
  const con = await waitFocus((f) => f.app_id === name, name);
  return { con, read: () => readFileSync(file, "utf8").split("\n").filter((l, i, a) => i < a.length - 1) };
}
// Chromium: a text field that posts its value on Enter to a local server.
const posted = [];
const web = createServer((req, res) => {
  let b = "";
  req.on("data", (d) => (b += d));
  req.on("end", () => {
    posted.push(b);
    res.writeHead(204, { "access-control-allow-origin": "*" });
    res.end();
  });
});
await new Promise((r) => web.listen(0, "127.0.0.1", r));
async function startChromium() {
  const port = web.address().port;
  const html = `<title>AncientVoid-Web</title><input id=f autofocus style="width:90%;font-size:20px"><script>f.addEventListener('keydown',e=>{if(e.key==='Enter'){fetch('http://127.0.0.1:${port}/',{method:'POST',body:f.value,mode:'no-cors'});f.value=''}})</script>`;
  const page = join(rt, "field.html");
  writeFileSync(page, html);
  const profile = mkdtempSync(join(tmpdir(), "ancientvoid-chromium-"));
  const p = spawn("chromium", ["--ozone-platform=wayland", `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "--disable-sync", "--disable-extensions", `--app=file://${page}`], { stdio: "ignore" });
  children.push(p);
  const con = await waitFocus((f) => /AncientVoid-Web/.test(f.name ?? ""), "chromium");
  await sleep(1500); // page + autofocus
  return con;
}

// ---- hub + companion ------------------------------------------------------
const dir = mkdtempSync(join(tmpdir(), "ancientvoid-desk-hub-"));
const db = new HubDatabase(":memory:");
const tokens = new TokenService(db);
const registry = new AdapterRegistry();
const sessions = new SessionManager(db, new EventStore(join(dir, ".data")), registry, new ProcessRunner());
const app = await createHubApp({ sessions, tokens, registry, auth: { tokens, enforceTailnetIdentity: false }, desktop: new DesktopService(db) });
app.log.level = "warn";
await app.listen({ port: 0, host: "127.0.0.1" });
const hub = `http://127.0.0.1:${app.server.address().port}`;
const human = tokens.issue("messlauf").token;
const companion = new Companion({ hub, token: tokens.issue("companion:lab").token, focus: new SwayBackend(exec, join(LAB, "usr/bin/swaymsg")), input: new WtypeInput(), focusedRole: atspiRole(), focusMs: 100 });
const control = serveControl(companion, join(rt, "companion.sock"));
const running = companion.run();

async function api(path, body) {
  const res = await fetch(`${hub}${path}`, { method: body ? "POST" : "GET", headers: { authorization: `Bearer ${human}`, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: res.status, body: await res.json() };
}
async function preview(conId) {
  for (let i = 0; i < 100; i++) {
    const c = (await api("/api/desktop")).body.companions[0];
    if (c?.focus?.id === String(conId)) return { companion: c.name, target: { id: c.focus.id, revision: c.focus.revision } };
    await sleep(50);
  }
  throw new Error("preview never matched");
}
async function finish(id) {
  for (let i = 0; i < 600; i++) {
    const a = (await api(`/api/desktop/actions/${id}`)).body;
    if (!["pending", "delivered", "running"].includes(a.status)) return a;
    await sleep(20);
  }
  throw new Error("action hung");
}
async function act(conId, body) {
  const t0 = performance.now();
  const r = await api("/api/desktop/actions", { ...(await preview(conId)), ...body });
  if (r.status !== 201) return { status: `http ${r.status}`, detail: r.body.error, ms: performance.now() - t0 };
  const a = await finish(r.body.id);
  return { ...a, ms: performance.now() - t0 };
}
async function waitFor(fn, ms = 4000) {
  for (let i = 0; i < ms / 50; i++) {
    const v = fn();
    if (v !== undefined) return v;
    await sleep(50);
  }
  return undefined;
}

const TEXTS = readFileSync(join(repo, "scripts/stt-bench/sentences.tsv"), "utf8").split("\n").slice(1, 11).map((l) => l.split("\t")[1]);
const report = { env: { sway: "1.12 (headless, pixman)", wtype: execFileSync("sh", ["-c", "pacman -Q wtype 2>/dev/null || echo wtype"], { encoding: "utf8" }).trim(), foot: execFileSync("foot", ["--version"], { encoding: "utf8" }).trim(), chromium: execFileSync("chromium", ["--version"], { encoding: "utf8" }).trim() }, apps: {}, race: [], stop: [], password: null };

async function flows(name, conId, read, correction) {
  const rows = [];
  for (const [i, text] of TEXTS.entries()) {
    await focusOn(conId);
    const before = read().length;
    const corr = correction && i >= 7;
    const r1 = corr ? await act(conId, { kind: "insert", text: "Tippfehler hier" }) : null;
    const r = await act(conId, { kind: corr ? "replace" : "insert", text });
    const k = await act(conId, { kind: "key", key: "Return" });
    const got = await waitFor(() => (read().length > before ? read()[read().length - 1] : undefined));
    rows.push({ flow: corr ? "korrigieren" : "diktieren", ok: got === text && r.status === "done" && k.status === "done" && (!r1 || r1.status === "done"), ms: Math.round(r.ms), got: got === text ? undefined : got, status: r.status, key: k.status, keyDetail: k.status === "done" ? undefined : k.detail, fix: r1?.status });
  }
  report.apps[name] = { ok: rows.filter((r) => r.ok).length, n: rows.length, p50ms: rows.map((r) => r.ms).sort((a, b) => a - b)[5], rows };
  console.log(`${name}: ${report.apps[name].ok}/${rows.length} richtig · p50 ${report.apps[name].p50ms} ms je Text`);
}

try {
  // AC-P11-1: three apps, ten flows each (the last three as corrections where the field allows).
  const gtk = await startGtk("gtk4", "AncientVoid-GTK4");
  await flows("GTK4-Feld", gtk.id, () => lines.get("gtk4"), true);
  const foot = await startFoot("ancientvoid-foot");
  await flows("foot (Terminal)", foot.con.id, foot.read, false);
  const chrome = await startChromium();
  await flows("Chromium-Feld", chrome.id, () => posted, true);

  // Focus race: (a) moved after the preview, (b) moved while typing.
  for (let i = 0; i < 10; i++) {
    await focusOn(gtk.id);
    const p = await preview(gtk.id);
    await focusOn(foot.con.id);
    const r = await api("/api/desktop/actions", { ...p, kind: "insert", text: `LEAK-A-${i}` });
    const a = r.status === 201 ? await finish(r.body.id) : { status: `http ${r.status}` };
    report.race.push({ case: "vorher", result: a.status });
  }
  for (let i = 0; i < 10; i++) {
    await focusOn(gtk.id);
    const beforeFoot = foot.read().length;
    const p = await preview(gtk.id);
    const r = await api("/api/desktop/actions", { ...p, kind: "insert", text: "x".repeat(600) });
    await sleep(150 + i * 20);
    await swaymsg(`[con_id=${foot.con.id}]`, "focus");
    const a = await finish(r.body.id);
    // Whatever reached the terminal after the switch shows on its next line.
    await exec("wtype", ["-s", "30", "-k", "Return"]);
    const leaked = (await waitFor(() => (foot.read().length > beforeFoot ? foot.read()[foot.read().length - 1] : undefined))) ?? "";
    await focusOn(gtk.id);
    await exec("wtype", ["-s", "30", "-k", "Return"]);
    report.race.push({ case: "während", result: a.status, typed: a.typedChars, leakedChars: leaked.length });
  }
  const during = report.race.filter((r) => r.case === "während");
  console.log(`Fokus vorher gewechselt: ${report.race.filter((r) => r.case === "vorher" && r.result !== "done").length}/10 verhindert · während: ${during.filter((r) => r.result === "failed").length} gestoppt + ${during.filter((r) => r.result === "refused").length} gar nicht begonnen (von 10), ins falsche Fenster: max ${Math.max(...during.map((r) => r.leakedChars))} Zeichen, ${during.filter((r) => r.leakedChars > 0).length}/10 mit Leck`);

  // AC-P11-3: local emergency stop.
  for (let i = 0; i < 10; i++) {
    await focusOn(gtk.id);
    lines.get("gtk4").length = 0;
    const p = await preview(gtk.id);
    const r = await api("/api/desktop/actions", { ...p, kind: "insert", text: "y".repeat(1200) });
    await sleep(200 + i * 30);
    const t0 = performance.now();
    await sendControl("stop", join(rt, "companion.sock"));
    const a = await finish(r.body.id);
    const reportedMs = performance.now() - t0;
    await sleep(500);
    await exec("wtype", ["-s", "30", "-k", "Return"]);
    const got = (await waitFor(() => lines.get("gtk4")[0])) ?? "";
    await sendControl("resume", join(rt, "companion.sock"));
    report.stop.push({ result: a.status, reportedMs: Math.round(reportedMs), typed: a.typedChars, inField: got.length, afterStop: got.length - a.typedChars });
  }
  const sm = report.stop.map((s) => s.reportedMs).sort((a, b) => a - b);
  console.log(`Not-Stopp: ${report.stop.filter((s) => s.result === "failed").length}/10 gestoppt · bis Rückmeldung p50 ${sm[4]} ms, max ${sm[9]} ms · nach dem Stopp noch getippt: max ${Math.max(...report.stop.map((s) => s.afterStop))} Zeichen`);

  // AC-P11-4: password fields (AT-SPI role) are refused — GTK4 and GTK3.
  report.password = [];
  for (const [label, extra] of [["GTK4", ["--password"]], ["GTK3", ["--password", "--gtk3"]]]) {
    const pw = await startGtk(`pw-${label}`, `AncientVoid-Zugang-${label}`, extra);
    await sleep(800);
    const pr = await act(pw.id, { kind: "insert", text: "hunter2" });
    report.password.push({ toolkit: label, status: pr.status, detail: pr.detail });
    console.log(`Passwortfeld ${label}: ${pr.status} — ${pr.detail}`);
  }

  // GTK3 as its own cell: does wtype's text reach a GTK3 field here?
  const g3 = await startGtk("gtk3", "AncientVoid-GTK3", ["--gtk3"]);
  let g3ok = 0;
  for (const text of TEXTS.slice(0, 3)) {
    const before = lines.get("gtk3").length;
    await act(g3.id, { kind: "insert", text });
    await act(g3.id, { kind: "key", key: "Return" });
    if ((await waitFor(() => (lines.get("gtk3").length > before ? lines.get("gtk3").at(-1) : undefined), 2000)) === text) g3ok++;
  }
  report.gtk3 = { ok: g3ok, n: 3 };
  console.log(`GTK3-Feld (eigene Zelle): ${g3ok}/3`);
} finally {
  writeFileSync(out, JSON.stringify(report, null, 1));
  console.log(`→ ${out}`);
  companion.shutdown();
  control.close();
  await app.close();
  await running.catch(() => undefined);
  await sessions.shutdown();
  web.close();
  for (const c of children.reverse()) c.kill();
}
