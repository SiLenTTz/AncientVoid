import { describe, expect, it, vi } from "vitest";
import { githubApi, reportFailures, syncPipeline } from "./ci-pipeline.mjs";

const run = { id: 42, run_attempt: 1, name: "nightly", event: "schedule", conclusion: "failure", head_sha: "abc", head_branch: "main", html_url: "https://github.com/a/b/actions/runs/42" };
const job = { name: "e2e-shards (2)", conclusion: "failure", html_url: `${run.html_url}/job/2` };

describe("pipeline branch", () => {
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
});

describe("nightly bugs", () => {
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
  it("paginates jobs and issues before deciding whether to create a bug", async () => {
    const api = vi.fn().mockResolvedValueOnce({ jobs: Array.from({ length: 100 }, () => ({ conclusion: "success" })) }).mockResolvedValueOnce({ jobs: [job] }).mockResolvedValueOnce(Array.from({ length: 100 }, () => ({ body: "unrelated" }))).mockResolvedValueOnce([{ number: 17, body: "<!-- ancientvoid-nightly:e2e-shards (2) -->" }]).mockResolvedValueOnce({});
    expect(await reportFailures(api, run)).toEqual([17]);
    expect(api.mock.calls[1][1]).toContain("page=2");
    expect(api.mock.calls[3][1]).toContain("page=2");
    expect(api.mock.calls[4][0]).toBe("PATCH");
  });
  it("does not silently accept an unexplained failed run", async () => {
    await expect(reportFailures(vi.fn().mockResolvedValue({ jobs: [] }), run)).rejects.toThrow("no failed jobs");
  });
  it("fails on API errors without exposing the token or response body", async () => {
    const request = vi.fn().mockResolvedValue({ ok: false, status: 403 });
    await expect(githubApi("private-token", "a/b", request)("POST", "issues", {})).rejects.toThrow("HTTP 403");
  });
});
