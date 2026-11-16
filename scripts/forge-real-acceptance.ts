/**
 * EPIC-P37 T37.6 — echte, isolierte GitLab-Abnahme (docs/forge-runbook.md §3). NICHT Teil des Gates.
 *   node --experimental-strip-types scripts/forge-real-acceptance.ts git@gitlab.com:<ns>/<wegwerf-projekt>.git
 * Schreibt in das angegebene Wegwerf-Projekt (Branches, MRs, Pipelines) und räumt am Ende auf. Nie gegen Produktiv-Projekte.
 */
import { execFileSync } from "node:child_process";
import { writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { TestHub } from "../e2e/support/hub.ts";

const remote = process.argv[2];
if (!remote) throw new Error("Aufruf: forge-real-acceptance.ts <git@gitlab.com:ns/projekt.git>");
const projectPath = remote.replace(/^git@[^:]+:/, "").replace(/\.git$/, "");
const pid = encodeURIComponent(projectPath);
const stamp = Date.now().toString(36);
const glabBin = execFileSync("which", ["glab"], { encoding: "utf8" }).trim();

const results: { step: string; ok: boolean; skipped?: boolean; detail: string }[] = [];
const check = (step: string, ok: boolean, detail = "") => {
  results.push({ step, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${step}${detail ? ` — ${detail}` : ""}`);
};
/** Nicht prüfbar (z. B. Kontingent) — zählt weder als bestanden noch als Fehler und steht im Bericht. */
const skip = (step: string, detail: string) => {
  results.push({ step, ok: true, skipped: true, detail });
  console.log(`SKIP  ${step} — ${detail}`);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const git = (cwd: string, ...a: string[]) => execFileSync("git", ["-c", "user.email=acceptance@ancientvoid.local", "-c", "user.name=AncientVoid Abnahme", ...a], { cwd, encoding: "utf8" });
const gl = <T>(path: string, method = "GET", fields: Record<string, string> = {}): T => {
  const args = ["api", path, "--method", method];
  for (const [k, v] of Object.entries(fields)) args.push("-f", `${k}=${v}`);
  return JSON.parse(execFileSync(glabBin, args, { encoding: "utf8" })) as T;
};
async function until<T>(label: string, fn: () => Promise<T | null | false>, ms = 300_000, every = 5_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`Zeit abgelaufen: ${label}`);
    await sleep(every);
  }
}

const CI = `stages: [test, child]
fail-job:
  stage: test
  image: alpine:3
  script:
    - echo FEHLER-AUS-DER-PIPELINE
    - exit 1
trigger-child:
  stage: child
  needs: []
  trigger:
    include: child.yml
`;
const CHILD = `child-job:
  image: alpine:3
  script:
    - echo CHILD-OK
`;

const hub = await TestHub.start({ forgeCommand: glabBin });
const created: { branches: string[]; mrs: number[] } = { branches: [], mrs: [] };
try {
  const clone = join(hub.projectsDir, "testhub");
  execFileSync("git", ["clone", "-q", remote, clone]);
  const base = git(clone, "rev-parse", "--abbrev-ref", "HEAD").trim();

  // 1./2. Branch mit absichtlich fehlschlagender Pipeline (+ Child-Pipeline über Bridge), MR öffnen
  const branchA = `accept/p37-${stamp}-a`;
  git(clone, "checkout", "-q", "-b", branchA);
  writeFileSync(join(clone, ".gitlab-ci.yml"), CI);
  writeFileSync(join(clone, "child.yml"), CHILD);
  git(clone, "add", "-A");
  git(clone, "commit", "-q", "-m", "ci: absichtlich fehlschlagende Pipeline (Abnahme)");
  git(clone, "push", "-q", "-u", "origin", branchA);
  created.branches.push(branchA);
  const mrA = gl<{ iid: number; web_url: string; sha: string; draft?: boolean; title: string }>(`projects/${pid}/merge_requests`, "POST", { source_branch: branchA, target_branch: base, title: `Draft: P37 Abnahme ${stamp}` });
  created.mrs.push(mrA.iid);
  check("MR im Wegwerf-Projekt geöffnet", Boolean(mrA.web_url), mrA.web_url);

  const pipeline = await until("Pipeline fehlgeschlagen", async () => {
    const list = gl<{ id: number; status: string; sha: string }[]>(`projects/${pid}/pipelines?ref=${encodeURIComponent(branchA)}`);
    const p = list[0];
    if (p && ["failed", "canceled"].includes(p.status)) return p;
    if (p && p.status === "success") throw new Error("Pipeline ist grün — Abnahme braucht eine fehlschlagende");
    return null;
  });
  check("Pipeline ist fehlgeschlagen", pipeline.status === "failed", `Pipeline ${pipeline.id} (${pipeline.status})`);

  // 3. Session auf dem Projekt, MR im Tab verknüpfen
  const sessionId = await hub.createSession({ adapter: "dummy", project: clone, workspaceMode: "direct", confirmDirty: true });
  const link = await hub.api<{ link: { mr: { mrIid: number } } }>(`/api/sessions/${sessionId}/forge/link`, { body: { url: mrA.web_url } });
  check("MR verknüpft", link.status === 200 && link.body.link.mr.mrIid === mrA.iid, `HTTP ${link.status}`);

  // 4. MR-Titel/Draft, Branch → Ziel, MR-Head = Pipeline-SHA, fehlgeschlagener Job, Trace, Child-Pipeline
  const ov = (await hub.api<{ mr: { title: string; draft: boolean; sourceBranch: string; targetBranch: string; sha: string }; pipelines: { id: number; sha: string; status: string }[]; shaDrift: boolean }>(`/api/sessions/${sessionId}/forge/overview`)).body;
  check("MR-Titel und Draft", ov.mr.title.includes("P37 Abnahme") && ov.mr.draft === true, `${ov.mr.title} draft=${ov.mr.draft}`);
  check("Branch → Ziel", ov.mr.sourceBranch === branchA && ov.mr.targetBranch === base, `${ov.mr.sourceBranch} → ${ov.mr.targetBranch}`);
  check("MR-Head = SHA der Pipeline", ov.mr.sha === pipeline.sha && ov.pipelines.some((p) => p.sha === ov.mr.sha), ov.mr.sha.slice(0, 8));
  const jobs = (await hub.api<{ items: { id: number; name: string; status: string; kind?: string; downstreamPipelineId?: number | null }[] }>(`/api/sessions/${sessionId}/forge/jobs?pipelineId=${pipeline.id}`)).body.items;
  console.log("      Jobs:", JSON.stringify(jobs));
  const failedJob = jobs.find((j) => j.name === "fail-job" && j.status === "failed");
  check("fehlgeschlagener Job sichtbar", Boolean(failedJob), failedJob ? `Job ${failedJob.id}` : "nicht gefunden");
  check("Child-Pipeline über Bridge sichtbar", jobs.some((j) => j.name === "trigger-child"), jobs.find((j) => j.name === "trigger-child")?.status ?? "keine Bridge");
  if (failedJob) {
    const traceRes = await hub.api<{ preview?: string; sizeBytes?: number; error?: string }>(`/api/sessions/${sessionId}/forge/trace?jobId=${failedJob.id}&pipelineId=${pipeline.id}`);
    console.log("      Trace:", traceRes.status, JSON.stringify(traceRes.body).slice(0, 300));
    const rawJob = gl<{ failure_reason?: string; started_at: string | null }>(`projects/${pid}/jobs/${failedJob.id}`);
    if (rawJob.started_at === null) skip("Trace lesbar", `Job wurde nie gestartet (failure_reason=${rawJob.failure_reason}) — kein Trace vorhanden; Runner/Kontingent fehlt`);
    else check("Trace lesbar", (traceRes.body.preview ?? "").includes("FEHLER-AUS-DER-PIPELINE"), `${traceRes.body.sizeBytes ?? 0} Bytes`);
  }

  // 5. Befund über Vorschau senden; Pipeline-/Job-ID und SHA im Prompt
  const finding = "Der Job fail-job bricht absichtlich ab — bitte Ursache nennen.";
  const prev = (await hub.api<{ prompt: string }>(`/api/sessions/${sessionId}/forge/feedback/preview`, { body: { finding, pipelineId: pipeline.id, jobId: failedJob?.id } })).body.prompt;
  check("Vorschau trägt Pipeline-/Job-ID und SHA", prev.includes(String(pipeline.id)) && prev.includes(String(failedJob?.id)) && prev.includes(ov.mr.sha.slice(0, 8)));
  const sent = await hub.api<{ ok: boolean; prompt: string }>(`/api/sessions/${sessionId}/forge/feedback`, { body: { operationId: `abnahme-${stamp}-1`, finding, pipelineId: pipeline.id, jobId: failedJob?.id } });
  check("Befund gesendet, Text = Vorschau", sent.status === 200 && sent.body.prompt === prev, `HTTP ${sent.status}`);
  await until("Prompt bei der Session", async () => (await hub.events(sessionId)).some((e) => JSON.stringify(e.payload).includes(String(pipeline.id)) && JSON.stringify(e.payload).includes("fail-job")), 30_000, 1000);

  // 6. Neuer Commit → „veraltet“, Versand ohne Neuladen wird abgewiesen
  writeFileSync(join(clone, "NEU.md"), `neu ${stamp}\n`);
  git(clone, "add", "-A");
  git(clone, "commit", "-q", "-m", "docs: zweiter Commit (Veraltet-Probe)");
  git(clone, "push", "-q", "origin", branchA);
  await until("MR-Head hat sich bewegt", async () => gl<{ sha: string }>(`projects/${pid}/merge_requests/${mrA.iid}`).sha !== ov.mr.sha, 60_000, 2000);
  const stale = await hub.api<{ ok: boolean; detail: string }>(`/api/sessions/${sessionId}/forge/feedback`, { body: { operationId: `abnahme-${stamp}-2`, finding, pipelineId: pipeline.id, jobId: failedJob?.id } });
  check("veralteter Befund wird abgewiesen", stale.status === 422 && /SHA/.test(stale.body.detail), stale.body.detail);
  const ov2 = (await hub.api<{ shaDrift: boolean }>(`/api/sessions/${sessionId}/forge/overview`)).body;
  check("Anzeige „veraltet“ (shaDrift)", ov2.shaDrift === true);

  // 7. Draft-MR vorbereiten (read-only) und erstellen — Antwortverlust (Hub-Kill) erzeugt keinen zweiten MR
  const branchB = `accept/p37-${stamp}-b`;
  git(clone, "checkout", "-q", "-b", branchB, base);
  writeFileSync(join(clone, "B.md"), `b ${stamp}\n`);
  git(clone, "add", "-A");
  git(clone, "commit", "-q", "-m", "docs: Draft-MR-Probe");
  created.branches.push(branchB);
  // P38: nur eine schreibende Session je Projekt — die erste vor der zweiten beenden
  await hub.api(`/api/sessions/${sessionId}/stop`, { body: {} });
  await until("erste Session beendet", async () => ["stopped", "idle", "error"].includes((await hub.api<{ status: string }>(`/api/sessions/${sessionId}`)).body.status), 30_000, 500);
  const session2 = await hub.createSession({ adapter: "dummy", project: clone, workspaceMode: "direct", confirmDirty: true });
  const plan = await hub.api<{ branch: string; pushNeeded: boolean; commitsAhead: unknown[] }>(`/api/sessions/${session2}/forge/mr/plan`, { body: {} });
  const remoteHasB = (() => { try { return execFileSync("git", ["ls-remote", "--heads", remote, branchB], { encoding: "utf8" }).trim() !== ""; } catch { return false; } })();
  check("Plan ist read-only (nichts gepusht, kein MR)", plan.status === 200 && plan.body.pushNeeded === true && !remoteHasB);
  const opId = `abnahme-${stamp}-mr`;
  const make = () => hub.api<{ ok: boolean; webUrl: string | null; detail: string | null }>(`/api/sessions/${session2}/forge/mr/create`, { body: { operationId: opId, title: `P37 Draft-Probe ${stamp}`, description: "Abnahme", targetBranch: base, push: true } });
  const first = await make();
  check("Draft-MR erstellt", first.status === 200 && first.body.ok && /\/merge_requests\/\d+/.test(first.body.webUrl ?? ""), first.body.webUrl ?? `HTTP ${first.status}`);
  const mrB = Number(/merge_requests\/(\d+)/.exec(first.body.webUrl ?? "")?.[1]);
  if (mrB) created.mrs.push(mrB);
  await hub.restart("SIGKILL"); // Antwort „verloren“: der Client versucht es nach dem Neustart erneut
  const second = await make();
  const open = gl<{ iid: number; source_branch: string }[]>(`projects/${pid}/merge_requests?state=opened&source_branch=${encodeURIComponent(branchB)}`);
  check("Wiederholung erzeugt keinen zweiten MR", second.status === 200 && open.length === 1, `${open.length} offener MR für ${branchB}`);

  // 8. Nach SIGKILL: Verknüpfung und Operationen sind zurück
  const back = (await hub.api<{ link: { mr: { mrIid: number } } | null }>(`/api/sessions/${sessionId}/forge/overview`)).body;
  check("Verknüpfung nach SIGKILL zurück", back.link?.mr.mrIid === mrA.iid);
  const ops = (await hub.api<{ items: { id: string; state: string }[] }>(`/api/sessions/${session2}/forge/operations`)).body.items;
  check("Operationen nach SIGKILL zurück", ops.some((o) => o.id === opId && o.state === "done"), JSON.stringify(ops.map((o) => `${o.id}:${o.state}`)));
} catch (err) {
  check("Abnahme ohne Ausnahme durchgelaufen", false, err instanceof Error ? err.message : String(err));
} finally {
  // Aufräumen im Wegwerf-Projekt
  for (const iid of created.mrs) { try { gl(`projects/${pid}/merge_requests/${iid}`, "PUT", { state_event: "close" }); } catch { /* egal */ } }
  for (const b of created.branches) { try { execFileSync("git", ["push", "-q", remote, "--delete", b], { stdio: "ignore" }); } catch { /* egal */ } }
  await hub.stop().catch(() => undefined);
  const failed = results.filter((r) => !r.ok);
  const skipped = results.filter((r) => r.skipped);
  const report = `# Forge-Abnahme (echtes GitLab) ${new Date().toISOString()}\nProjekt: ${projectPath}\n\n${results.map((r) => `- ${r.skipped ? "SKIP" : r.ok ? "PASS" : "FAIL"} ${r.step}${r.detail ? ` — ${r.detail}` : ""}`).join("\n")}\n`;
  appendFileSync("/tmp/forge-abnahme.md", report);
  console.log(`\n${results.length - failed.length - skipped.length}/${results.length} bestanden, ${skipped.length} übersprungen${failed.length ? `, ${failed.length} FEHLER` : ""}`);
  process.exit(failed.length ? 1 : 0);
}
