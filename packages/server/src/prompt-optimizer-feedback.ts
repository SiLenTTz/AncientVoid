import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * T3.9 (EPIC-P3 §3 "Learning-Loop (lokal)"): every time a user accepts or
 * discards the T1.5-8 prompt optimizer's suggestion, that decision is
 * appended here — the raw material a later, periodic revision of the
 * optimizer's own system prompt (enhance.ts's `INSTRUCTION`) would read.
 *
 * Scope line, stated honestly rather than silently gapped: this module is
 * the "lokale JSONL-Sammlung" half of T3.9. The "periodische Optimizer-
 * Prompt-Revision" half — something actually reading this file and
 * deciding to change `INSTRUCTION` — is a real algorithm/product decision
 * (what counts as a revision-worthy pattern? how often? auto-applied or
 * proposed for review?) that doesn't have a real answer yet and is not
 * invented here. This file exists so that decision has real data to work
 * from whenever it's made, not so it can be marked done today.
 *
 * "Niemals Cloud, niemals Telemetrie" (EPIC-P3 §3): this is a plain local
 * file append — no network call, no analytics SDK, nothing external.
 */

export interface OptimizerFeedbackEntry {
  ts: string;
  adapter: string;
  project: string;
  original: string;
  enhanced: string;
  decision: "accepted" | "rejected";
  costUsd?: number;
  latencyMs: number;
}

function feedbackPath(dataDir: string): string {
  return join(dataDir, "prompt-optimizer-feedback.jsonl");
}

export async function appendOptimizerFeedback(
  dataDir: string,
  entry: Omit<OptimizerFeedbackEntry, "ts">,
): Promise<void> {
  await mkdir(dataDir, { recursive: true });
  const full: OptimizerFeedbackEntry = { ts: new Date().toISOString(), ...entry };
  await appendFile(feedbackPath(dataDir), JSON.stringify(full) + "\n", "utf8");
}

/** Exposed for a future revision job and for tests — never sent anywhere. */
export async function readOptimizerFeedback(dataDir: string): Promise<OptimizerFeedbackEntry[]> {
  let raw: string;
  try {
    raw = await readFile(feedbackPath(dataDir), "utf8");
  } catch {
    return [];
  }
  return raw
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as OptimizerFeedbackEntry);
}
