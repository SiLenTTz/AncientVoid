import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { load } from "js-yaml";
import { closeResolved, githubApi, pipelineSha, reportFailures, resolvePipeline, syncPipeline } from "./ci-pipeline.mjs";

const run = { id: 42, run_attempt: 1, name: "nightly", event: "schedule", conclusion: "failure", head_sha: "abc", head_branch: "main", html_url: "https://github.com/a/b/actions/runs/42" };
const job = { name: "e2e-shards (2)", conclusion: "failure", html_url: `${run.html_url}/job/2` };

describe("pipeline branch", () => {
  it("resolves a frozen test SHA without requiring write access", async () => {
    const api = vi.fn().mockResolvedValue({ object: { sha: "frozen" } });
    expect(await pipelineSha(api)).toBe("frozen");
    expect(api.mock.calls).toEqual([["GET", "git/ref/heads/ci/full-suite"]]);
    await expect(pipelineSha(vi.fn().mockRejectedValue(new Error("missing branch")))).rejects.toThrow("missing branch");
  });
  it("creates a missing branch at main, without swallowing permission errors", async () => {
    const api = vi.fn().mockResolvedValueOnce({ object: { sha: "abc" } }).mockRejectedValueOnce(Object.assign(new Error(), { status: 404 })).mockResolvedValueOnce({});
    expect(await syncPipeline(api)).toBe("abc");
    expect(api).toHaveBeenLastCalledWith("POST", "git/refs", { ref: "refs/heads/ci/full-suite", sha: "abc" });
    const denied = vi.fn().mockResolvedValueOnce({ object: { sha: "abc" } }).mockRejectedValueOnce(Object.assign(new Error("denied"), { status: 403 }));
    await expect(syncPipeline(denied)).rejects.toThrow("denied");
    expect(denied).toHaveBeenCalledTimes(2);
  });
  it("fast-forwards and fails loudly on divergence", async () => {
    const api = vi.fn().mockResolvedValueOnce({ object: { sha: "new" } }).mockResolvedValueOnce({}).mockRejectedValueOnce(new Error("diverged"));
    await expect(syncPipeline(api)).rejects.toThrow("diverged");
    expect(api).toHaveBeenLastCalledWith("PATCH", "git/refs/heads/ci/full-suite", { sha: "new", force: false });
  });
  it("resolve liefert sofort, wenn der Testbranch auf main steht", async () => {
    const api = vi.fn()
      .mockResolvedValueOnce({ object: { sha: "head" } }) // main
      .mockResolvedValue({ object: { sha: "head" } }); // ci/full-suite
    expect(await resolvePipeline(api, { sleep: vi.fn() })).toBe("head");
  });
  it("resolve wartet, bis ein laufender Sync den Testbranch nachgezogen hat", async () => {
    const api = vi.fn()
      .mockResolvedValueOnce({ object: { sha: "head" } }) // main
      .mockResolvedValueOnce({ object: { sha: "alt" } }) // ci/full-suite: noch beim Vorgaenger
      .mockResolvedValueOnce({ object: { sha: "head" } }); // nach dem Sync
    expect(await resolvePipeline(api, { sleep: vi.fn() })).toBe("head");
    expect(api).toHaveBeenCalledTimes(3);
  });
  it("resolve scheitert laut, wenn der Sync nach Fristablauf fehlt", async () => {
    const api = vi.fn()
      .mockResolvedValueOnce({ object: { sha: "head" } }) // main
      .mockResolvedValue({ object: { sha: "alt" } }); // ci/full-suite bleibt alt
    await expect(resolvePipeline(api, { waitMs: 0, sleep: vi.fn() })).rejects.toThrow("liegt hinter main");
  });
});

describe("nightly bugs", () => {
  it("also reports sync failures without colliding with full-suite bugs", async () => {
    const api = vi.fn().mockResolvedValueOnce({ jobs: [job] }).mockResolvedValueOnce([]).mockResolvedValueOnce({ number: 20 });
    expect(await reportFailures(api, { ...run, name: "pipeline-sync", event: "push" })).toEqual([20]);
    expect(api.mock.calls[2][2].title).toContain("pipeline-sync");
    expect(api.mock.calls[2][2].body).toContain("<!-- ancientvoid-nightly:pipeline-sync/e2e-shards (2) -->");
  });
  it("creates a bug with SHA, evidence and reproduction, only for failing jobs", async () => {
    const api = vi.fn().mockResolvedValueOnce({ jobs: [job, { name: "k8", conclusion: "success" }] }).mockResolvedValueOnce([]).mockResolvedValueOnce({ number: 17 });
    expect(await reportFailures(api, run)).toEqual([17]);
    const [method, path, issue] = api.mock.calls[2];
    expect([method, path]).toEqual(["POST", "issues"]);
    expect(issue.labels).toEqual(["bug"]);
    expect(issue.body).toContain("abc");
    expect(issue.body).toContain(job.html_url);
    expect(issue.body).toContain("Reproduktion:");
  });
  it("deduplicates an open bug and updates the latest occurrence, idempotently", async () => {
    const old = { number: 17, body: "<!-- ancientvoid-nightly:e2e-shards (2) -->" };
    const api = vi.fn().mockResolvedValueOnce({ jobs: [job] }).mockResolvedValueOnce([old]).mockResolvedValueOnce({});
    await reportFailures(api, run);
    expect(api.mock.calls[2].slice(0, 2)).toEqual(["PATCH", "issues/17"]);
    const body = api.mock.calls[2][2].body;
    const replay = vi.fn().mockResolvedValueOnce({ jobs: [job] }).mockResolvedValueOnce([{ number: 17, body }]);
    expect(await reportFailures(replay, run)).toEqual([17]);
    expect(replay).toHaveBeenCalledTimes(2);
  });
  it("ignores success, cancellation and PR workflows", async () => {
    const api = vi.fn();
    for (const override of [{ conclusion: "success" }, { conclusion: "cancelled" }, { event: "pull_request" }, { name: "ci" }]) expect(await reportFailures(api, { ...run, ...override })).toEqual([]);
    expect(api).not.toHaveBeenCalled();
  });
  it("preserves human investigation outside the managed report block", async () => {
    const body = "Human root cause\n<!-- ancientvoid-nightly:e2e-shards (2) -->\nold report\n<!-- /ancientvoid-nightly -->\nHuman follow-up";
    const api = vi.fn().mockResolvedValueOnce({ jobs: [job] }).mockResolvedValueOnce([{ number: 17, body }]).mockResolvedValueOnce({});
    await reportFailures(api, run);
    const updated = api.mock.calls[2][2].body;
    expect(updated).toContain("Human root cause");
    expect(updated).toContain("Human follow-up");
    expect(updated).not.toContain("old report");
    expect(updated).toContain("<!-- run:42:1 -->");
  });
  it("paginates jobs and issues before deciding whether to create a bug", async () => {
    const api = vi.fn().mockResolvedValueOnce({ jobs: Array.from({ length: 100 }, () => ({ conclusion: "success" })) }).mockResolvedValueOnce({ jobs: [job] }).mockResolvedValueOnce(Array.from({ length: 100 }, () => ({ body: "unrelated" }))).mockResolvedValueOnce([{ number: 17, body: "<!-- ancientvoid-nightly:e2e-shards (2) -->" }]).mockResolvedValueOnce({});
    expect(await reportFailures(api, run)).toEqual([17]);
    expect(api.mock.calls[1][1]).toContain("page=2");
    expect(api.mock.calls[3][1]).toContain("page=2");
    expect(api.mock.calls[4][0]).toBe("PATCH");
  });
  it("reports workflow startup failures even when no job could start", async () => {
    const api = vi.fn().mockResolvedValueOnce({ jobs: [] }).mockResolvedValueOnce([]).mockResolvedValueOnce({ number: 18 });
    expect(await reportFailures(api, { ...run, conclusion: "startup_failure" })).toEqual([18]);
    expect(api.mock.calls[2][2].title).toContain("workflow startup");
  });
  it("reports timed-out workflows and jobs", async () => {
    const api = vi.fn().mockResolvedValueOnce({ jobs: [{ ...job, conclusion: "timed_out" }] }).mockResolvedValueOnce([]).mockResolvedValueOnce({ number: 19 });
    expect(await reportFailures(api, { ...run, conclusion: "timed_out" })).toEqual([19]);
    expect(api.mock.calls[2][2].body).toContain("timed_out");
  });
  it("fails on API errors without exposing the token or response body", async () => {
    const request = vi.fn().mockResolvedValue({ ok: false, status: 403 });
    await expect(githubApi("private-token", "a/b", request)("POST", "issues", {})).rejects.toThrow("HTTP 403");
  });
});

const greenRun = { id: 43, run_attempt: 1, name: "nightly", event: "schedule", conclusion: "success", head_sha: "def", head_branch: "main", html_url: "https://github.com/a/b/actions/runs/43" };
const greenJob = { name: "e2e-shards (2)", conclusion: "success", html_url: `${greenRun.html_url}/job/2` };
const redJob = { name: "e2e", conclusion: "failure", html_url: `${greenRun.html_url}/job/3` };

describe("closeResolved (EPIC-P71 auto-close)", () => {
  it("closes open CI bugs whose job went green, with run/SHA/job evidence", async () => {
    const issue = { number: 17, body: "<!-- ancientvoid-nightly:e2e-shards (2) -->\n<!-- run:42:1 -->\nold report\n<!-- /ancientvoid-nightly -->" };
    const api = vi.fn().mockResolvedValueOnce({ jobs: [greenJob, redJob] }).mockResolvedValueOnce([issue]).mockResolvedValueOnce({}).mockResolvedValueOnce({});
    expect(await closeResolved(api, greenRun)).toEqual([17]);
    expect(api.mock.calls[2].slice(0, 2)).toEqual(["POST", "issues/17/comments"]);
    expect(api.mock.calls[2][2].body).toContain("e2e-shards (2)");
    expect(api.mock.calls[2][2].body).toContain("def");
    expect(api.mock.calls[2][2].body).toContain(`${greenRun.html_url}/job/2`);
    expect(api.mock.calls[3].slice(0, 2)).toEqual(["PATCH", "issues/17"]);
    expect(api.mock.calls[3][2].state).toBe("closed");
  });
  it("keeps bugs of still-red jobs and of other workflows open for reportFailures", async () => {
    const issues = [{ number: 18, body: "<!-- ancientvoid-nightly:e2e -->" }, { number: 21, body: "<!-- ancientvoid-nightly:pipeline-sync/e2e -->" }];
    const api = vi.fn().mockResolvedValueOnce({ jobs: [greenJob, redJob] }).mockResolvedValueOnce(issues);
    expect(await closeResolved(api, greenRun)).toEqual([]);
    expect(api).toHaveBeenCalledTimes(2);
  });
  it("fetches no issues when no job is green", async () => {
    const api = vi.fn().mockResolvedValueOnce({ jobs: [redJob] });
    expect(await closeResolved(api, { ...greenRun, conclusion: "failure" })).toEqual([]);
    expect(api).toHaveBeenCalledTimes(1);
  });
  it("ignores cancelled runs, PR runs and non-nightly workflows", async () => {
    const api = vi.fn();
    for (const override of [{ conclusion: "cancelled" }, { event: "pull_request" }, { name: "pipeline-sync" }]) expect(await closeResolved(api, { ...greenRun, ...override })).toEqual([]);
    expect(api).not.toHaveBeenCalled();
  });
  it("is idempotent on redelivery: already closed issues are not listed anymore", async () => {
    const api = vi.fn().mockResolvedValueOnce({ jobs: [greenJob] }).mockResolvedValueOnce([]);
    expect(await closeResolved(api, greenRun)).toEqual([]);
    expect(api).toHaveBeenCalledTimes(2);
  });
  it("closes workflow-startup bugs only once the whole run is green", async () => {
    const issue = { number: 19, body: "<!-- ancientvoid-nightly:workflow startup -->" };
    const api = vi.fn().mockResolvedValueOnce({ jobs: [greenJob] }).mockResolvedValueOnce([issue]);
    expect(await closeResolved(api, { ...greenRun, conclusion: "failure" })).toEqual([]);
    expect(api).toHaveBeenCalledTimes(2);
    const replay = vi.fn().mockResolvedValueOnce({ jobs: [greenJob] }).mockResolvedValueOnce([issue]).mockResolvedValueOnce({}).mockResolvedValueOnce({});
    expect(await closeResolved(replay, greenRun)).toEqual([19]);
    expect(replay.mock.calls[2][2].body).toContain("workflow startup");
  });
  it("paginates issues before closing anything", async () => {
    const issue = { number: 17, body: "<!-- ancientvoid-nightly:e2e-shards (2) -->" };
    const api = vi.fn().mockResolvedValueOnce({ jobs: [greenJob] }).mockResolvedValueOnce(Array.from({ length: 100 }, () => ({ body: "unrelated" }))).mockResolvedValueOnce([issue]).mockResolvedValueOnce({}).mockResolvedValueOnce({});
    expect(await closeResolved(api, greenRun)).toEqual([17]);
    expect(api.mock.calls[2][1]).toContain("page=2");
    expect(api.mock.calls[3][0]).toBe("POST");
  });
});

describe("workflow routing and permissions", () => {
  const workflow = (name) => load(readFileSync(new URL(`../.github/workflows/${name}.yml`, import.meta.url), "utf8"));
  it("routes main pushes to an independent short sync, never behind the full suite", () => {
    const sync = workflow("pipeline-sync");
    const full = workflow("nightly");
    expect(sync.on.push.branches).toEqual(["main"]);
    expect(full.on).not.toHaveProperty("push");
    expect(sync.concurrency.group).not.toBe(full.concurrency.group);
    expect(Object.keys(sync.jobs)).toEqual(["sync"]);
    expect(sync.jobs.sync.needs).toBeUndefined();
  });
  it("keeps full-suite code read-only and reports sync errors from trusted code", () => {
    const full = workflow("nightly");
    expect(full.permissions).toEqual({ contents: "read" });
    expect(full.jobs.prepare.permissions).toBeUndefined();
    expect(full.jobs.prepare.steps.find((step) => step.run)?.run).toBe("node scripts/ci-pipeline.mjs resolve");
    expect(workflow("pipeline-sync").jobs.sync.permissions).toEqual({ contents: "write" });
    expect(workflow("nightly-bugs").on.workflow_run.workflows).toContain("pipeline-sync");
  });
  it("runs the close step on green runs from trusted main code within the serialized group", () => {
    const bugs = workflow("nightly-bugs");
    expect(bugs.concurrency.group).toBe("nightly-bugs");
    expect(bugs.jobs.close.steps.find((step) => step.run)?.run).toBe("node scripts/ci-pipeline.mjs close");
    expect(bugs.jobs.close.steps.find((step) => step.uses?.startsWith("actions/checkout"))?.with?.ref).toBe("main");
    expect(bugs.jobs.close.if).toContain("success");
    expect(bugs.jobs.report.if).toContain("failure");
  });
});
