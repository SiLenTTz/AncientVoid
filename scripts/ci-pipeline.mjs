import { appendFileSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export function githubApi(token, repository, request = globalThis.fetch) {
  if (!token || !/^[\w.-]+\/[\w.-]+$/.test(repository ?? "")) throw new Error("GitHub token/repository missing or invalid");
  return async (method, path, body) => {
    const response = await request(`https://api.github.com/repos/${repository}/${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) {
      const error = new Error(`GitHub ${method} ${path}: HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return response.status === 204 ? null : response.json();
  };
}

// Only fast-forward: an accidentally diverged pipeline branch must fail visibly.
export async function syncPipeline(api) {
  const main = await api("GET", "git/ref/heads/main");
  const sha = main.object.sha;
  try {
    await api("GET", "git/ref/heads/ci/full-suite");
  } catch (error) {
    if (error.status !== 404) throw error;
    await api("POST", "git/refs", { ref: "refs/heads/ci/full-suite", sha });
    return sha;
  }
  await api("PATCH", "git/refs/heads/ci/full-suite", { sha, force: false });
  return sha;
}

export async function reportFailures(api, run) {
  const failed = (conclusion) => ["failure", "timed_out", "action_required", "startup_failure"].includes(conclusion);
  if (run.name !== "nightly" || run.event === "pull_request" || !failed(run.conclusion)) return [];
  const jobs = [];
  for (let page = 1; ; page++) {
    const result = await api("GET", `actions/runs/${run.id}/jobs?filter=latest&per_page=100&page=${page}`);
    jobs.push(...result.jobs);
    if (result.jobs.length < 100) break;
  }
  const failures = jobs.filter((job) => failed(job.conclusion));
  // A workflow can fail before a runner/job starts; that must still create a bug.
  if (failures.length === 0) failures.push({ name: "workflow startup", conclusion: run.conclusion, html_url: run.html_url });
  const issues = [];
  for (let page = 1; ; page++) {
    const result = await api("GET", `issues?state=open&labels=bug&per_page=100&page=${page}`);
    issues.push(...result.filter((issue) => !issue.pull_request));
    if (result.length < 100) break;
  }
  const numbers = [];
  for (const job of failures) {
    const marker = `<!-- ancientvoid-nightly:${job.name} -->`;
    const occurrence = `<!-- run:${run.id}:${run.run_attempt} -->`;
    const body = `${marker}\n${occurrence}\nAutomatisch erkannter Pipeline-Fehler (EPIC-P28, K1–K10).\n\nJob: ${job.name}\nCommit: ${run.head_sha}\nBranch: ${run.head_branch}\nErgebnis: ${job.conclusion}\n\n[Lauf und Artefakte](${run.html_url}) · [Job](${job.html_url})\n\nReproduktion: Kommandos des Jobs auf diesem Commit ausführen; Fehler zuerst als Produkt/Test oder Infrastruktur klassifizieren (docs/ci-runbook.md). Ein roter Lauf ist kein bestandener Test.\n`;
    const existing = issues.find((issue) => issue.body?.includes(marker));
    if (existing) {
      // Updating the body is idempotent, even when workflow_run is redelivered.
      if (!existing.body.includes(occurrence)) await api("PATCH", `issues/${existing.number}`, { body });
      numbers.push(existing.number);
    } else {
      const issue = await api("POST", "issues", { title: `CI-Bug: nightly / ${job.name}`, labels: ["bug"], body });
      numbers.push(issue.number);
    }
  }
  return numbers;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const api = githubApi(process.env.GH_TOKEN, process.env.GITHUB_REPOSITORY);
  if (process.argv[2] === "sync") {
    const sha = await syncPipeline(api);
    appendFileSync(process.env.GITHUB_OUTPUT, `sha=${sha}\n`);
  } else if (process.argv[2] === "report") {
    const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
    const id = event.inputs?.run_id;
    if (!event.workflow_run && !/^\d+$/.test(id ?? "")) throw new Error("Missing/invalid nightly run ID");
    const run = event.workflow_run ?? await api("GET", `actions/runs/${id}`);
    console.log("CI bug issues:", await reportFailures(api, run));
  } else {
    throw new Error("Usage: node scripts/ci-pipeline.mjs sync|report");
  }
}
