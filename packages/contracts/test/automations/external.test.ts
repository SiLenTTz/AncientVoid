import { describe, expect, it } from "vitest";
import { EXTERNAL_JOB_SOURCES, EXTERNAL_JOB_STATUSES, ExternalJobInfo, ExternalJobsResponse } from "@ancientvoid/contracts";

const job = {
  source: "github-actions",
  name: "nightly / e2e",
  status: "failed",
  detail: "conclusion=failure",
  url: "https://github.com/securesight-ai/AncientVoid/actions/runs/1",
  atUtc: "2026-11-19T03:12:44.000Z",
};

describe("external job contracts (ADR-0094 / EPIC-P73)", () => {
  it("takes a flat job from either source with optional detail/url", () => {
    for (const source of EXTERNAL_JOB_SOURCES) {
      expect(ExternalJobInfo.safeParse({ ...job, source }).success).toBe(true);
    }
    expect(ExternalJobInfo.parse(job)).toMatchObject({ status: "failed" });
  });

  it("rejects unknown sources and statuses — the PWA must never guess-render", () => {
    expect(ExternalJobInfo.safeParse({ ...job, source: "cron" }).success).toBe(false);
    expect(ExternalJobInfo.safeParse({ ...job, status: "flaky" }).success).toBe(false);
    expect(EXTERNAL_JOB_STATUSES).toContain("unknown");
  });

  it("bounds name/detail/url and requires a full ISO timestamp", () => {
    expect(ExternalJobInfo.safeParse({ ...job, name: "x".repeat(121) }).success).toBe(false);
    expect(ExternalJobInfo.safeParse({ ...job, name: "" }).success).toBe(false);
    expect(ExternalJobInfo.safeParse({ ...job, detail: "x".repeat(501) }).success).toBe(false);
    expect(ExternalJobInfo.safeParse({ ...job, url: "x".repeat(501) }).success).toBe(false);
    expect(ExternalJobInfo.safeParse({ ...job, atUtc: "2026-11-19" }).success).toBe(false);
  });

  it("response carries atUtc, honest staleError and caps the list", () => {
    const body = { atUtc: "2026-11-19T08:00:00.000Z", staleError: null, jobs: [job] };
    expect(ExternalJobsResponse.safeParse(body).success).toBe(true);
    expect(ExternalJobsResponse.safeParse({ ...body, staleError: "HTTP 403" }).success).toBe(true);
    expect(ExternalJobsResponse.safeParse({ ...body, staleError: 5 }).success).toBe(false);
    expect(ExternalJobsResponse.safeParse({ ...body, jobs: Array(101).fill(job) }).success).toBe(false);
    expect(ExternalJobsResponse.safeParse({ ...body, jobs: Array(100).fill(job) }).success).toBe(true);
  });
});
