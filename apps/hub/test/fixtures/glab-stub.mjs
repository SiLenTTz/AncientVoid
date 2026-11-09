#!/usr/bin/env node
// EPIC-P37: glab-Stub für Integrationstests und E2E (ADR-0056 §3).
// Spricht dieselbe argv-Schnittstelle wie `glab api`. Zustand (MR-SHA,
// angelegte MRs) liegt in der Datei aus GLAB_STUB_STATE — so sind
// Retry-Abgleich (AC-P37-5) und SHA-Drift deterministisch prüfbar.
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const argv = process.argv.slice(3); // ["api", ...rest] → Pfad + Flags
const path = argv[0] ?? "";
const stateFile = process.env.GLAB_STUB_STATE ?? "/tmp/glab-stub-state.json";

function readState() {
  if (!existsSync(stateFile)) return { mrSha: "aaaa000000000000000000000000000000000000", createdMrs: [] };
  try {
    return JSON.parse(readFileSync(stateFile, "utf8"));
  } catch {
    return { mrSha: "aaaa000000000000000000000000000000000000", createdMrs: [] };
  }
}

function json(obj) {
  process.stdout.write(JSON.stringify(obj));
  process.exit(0);
}

const state = readState();
const query = path.split("?")[1] ?? "";
const clean = path.split("?")[0];

if (clean === "projects/team%2Fproj" || clean === "projects/42") {
  json({ id: 42, path_with_namespace: "team/proj", web_url: "https://gitlab.example/team/proj" });
}

if (clean === "projects/42/merge_requests/7" || clean === "projects/team%2Fproj/merge_requests/7") {
  json({
    id: 700,
    iid: 7,
    title: "Draft: Test-MR",
    state: "opened",
    draft: true,
    source_branch: "feat/dummy",
    target_branch: "main",
    sha: state.mrSha,
    web_url: "https://gitlab.example/team/proj/-/merge_requests/7",
    author: { username: "jan" },
    updated_at: "2026-11-08T08:00:00Z",
    references: { full: "team/proj!7" },
  });
}

if (clean === "projects/42/pipelines") {
  json([
    { id: 3, iid: 3, status: "failed", sha: state.mrSha, ref: "feat/dummy", web_url: "u3", created_at: "2026-11-08T07:00:00Z" },
    { id: 2, iid: 2, status: "pending", sha: state.mrSha, ref: "feat/dummy", web_url: "u2", created_at: "2026-11-08T06:00:00Z" },
    { id: 1, iid: 1, status: "success", sha: state.mrSha, ref: "feat/dummy", web_url: "u1", created_at: "2026-11-08T05:00:00Z" },
  ]);
}

if (clean === "projects/42/pipelines/3/jobs") {
  json([{ id: 55, name: "verify", status: "failed", stage: "test", allow_failure: false, web_url: "u#L55" }]);
}
if (clean === "projects/42/pipelines/3/bridges") {
  json([{ id: 60, name: "bridge:e2e", status: "failed", stage: "test", allow_failure: false, downstream_pipeline: { id: 77 }, web_url: "u#L60" }]);
}
if (clean === "projects/42/pipelines/77/jobs") {
  json([{ id: 80, name: "e2e", status: "failed", stage: "test", allow_failure: false, web_url: "u#L80" }]);
}

if (clean === "projects/42/jobs/55/trace") {
  process.stdout.write("Zeile 1: Build gestartet\nZeile 2: Fehler in app.ts:12\nZeile 3: Prozess beendet mit Code 1\n");
  process.exit(0);
}

if (clean === "projects/42/merge_requests/7/discussions") {
  json([
    {
      id: "d1",
      notes: [{ author: { username: "reviewer" }, body: "Bitte Zeile 12 prüfen.", system: false, created_at: "2026-11-08T07:30:00Z" }],
    },
  ]);
}

if (clean === "projects/42/merge_requests" && query.includes("source_branch=")) {
  json(state.createdMrs);
}

if (clean === "projects/42/issues") {
  json([{ iid: 5, title: "Login bricht ab", description: "Beschreibung des Issues", state: "opened", author: { username: "jan" }, web_url: "https://gitlab.example/team/proj/-/issues/5", labels: ["bug"] }]);
}

// POST: MR anlegen — schreibt zuerst in den Zustand und SIMULIERT dann je nach
// GLAB_STUB_LOSE_RESPONSE optional eine verlorene Antwort (AC-P37-5).
if (clean === "projects/42/merge_requests" && argv.includes("-X") && argv[argv.indexOf("-X") + 1] === "POST") {
  const fields = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "-f" && argv[i + 1]) {
      const eq = argv[i + 1].indexOf("=");
      fields[argv[i + 1].slice(0, eq)] = argv[i + 1].slice(eq + 1);
    }
  }
  const mr = {
    id: 900 + state.createdMrs.length,
    iid: 9 + state.createdMrs.length,
    title: fields.title ?? "Draft",
    state: "opened",
    source_branch: fields.source_branch,
    target_branch: fields.target_branch,
    sha: state.mrSha,
    web_url: `https://gitlab.example/team/proj/-/merge_requests/${9 + state.createdMrs.length}`,
  };
  state.createdMrs.push(mr);
  writeFileSync(stateFile, JSON.stringify(state));
  if (process.env.GLAB_STUB_LOSE_RESPONSE === "1") {
    process.stderr.write("Post https://gitlab.example/api/v4/projects/42/merge_requests: dial tcp: connection refused");
    process.exit(1);
  }
  json(mr);
}

process.stderr.write(`404 Not Found {message: 404 Projekt nicht gefunden (${clean})}`);
process.exit(1);
