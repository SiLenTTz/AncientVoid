import type { MainSyncApplyResult, MainSyncCheckResult } from "@ancientvoid/contracts";
import { api } from "./api.ts";

/**
 * EPIC-P67 T67.9: `hubctl main-sync` — Messung/Probelauf und Einmischen für
 * Skripte (Menschen-Token; die Policy lässt Agenten bewusst nicht schreiben).
 * `--project` wendet auf alle Worktree-Sessions eines Projekts an — der
 * Scheduler macht denselben Rundumschlag mit einem Fetch je Projekt.
 */

interface SessionRow {
  id: string;
  project: string;
  status: string;
}

/** Rein, für Tests: die Messung als Zeilen. */
export function formatMainSyncCheck(check: MainSyncCheckResult, sessionId: string): string[] {
  const lines = [
    `${sessionId} · origin/${check.branch}: ${check.behind === 0 ? "aktuell" : `${check.behind} hinten, ${check.ahead} vorn`}${check.clean ? "" : " · Worktree hat Ungesichertes"}`,
  ];
  if (check.conflicts && check.conflicts.length > 0) lines.push(`konflikt (Probelauf): ${check.conflicts.join(", ")}`);
  else lines.push("probelauf: sauber");
  lines.push(`zuletzt abgeglichen: ${check.lastSyncedAt ? new Date(check.lastSyncedAt).toLocaleString() : "nie"}`);
  return lines;
}

/** Rein, für Tests: das Apply-Ergebnis als Zeilen. */
export function formatMainSyncApply(result: MainSyncApplyResult): string {
  switch (result.outcome) {
    case "applied":
      return `ok: origin/main eingemischt (${result.from} → ${result.to}, ${result.files.length} Datei${result.files.length === 1 ? "" : "en"})`;
    case "conflict":
      return `konflikt in ${result.files.join(", ")} — nichts verändert, in der Session lösen`;
    case "skipped":
      return `übersprungen (${result.reason}${result.detail ? `: ${result.detail}` : ""})`;
    case "failed":
      return `gescheitert (${result.reason}${result.detail ? `: ${result.detail}` : ""})`;
  }
}

function usage(): never {
  console.log(`hubctl main-sync — EPIC-P67 (ADR-0088)

Usage:
  hubctl main-sync <sessionId> [--check|--apply]   Messung + Probelauf (Standard) oder Einmischen
  hubctl main-sync --project <pfad> [--check|--apply]   alle Worktree-Sessions des Projekts
  hubctl main-sync --settings                      globale Einstellungen und Projekt-Overrides

Einmischen nur auf wartenden Sessions (Gating im Hub, AC-P67-6);
Konflikte werden nie aufgelöst, nur benannt — der Hub mischt nichts halb ein.`);
  process.exit(1);
}

export async function runMainSync(args: string[]): Promise<void> {
  const apply = args.includes("--apply");
  const check = args.includes("--check");
  if (apply && check) usage();

  if (args[0] === "--settings") {
    const settings = await api<{ global: { value: Record<string, unknown>; fallback: string }; projects: { value: Record<string, Record<string, unknown>>; fallback: string } }>("/api/settings/main-sync");
    console.log(`global (${settings.global.fallback === "none" ? "gespeichert" : `Defaults, Eintrag ${settings.global.fallback}`}):`);
    for (const [key, value] of Object.entries(settings.global.value)) console.log(`  ${key}: ${JSON.stringify(value)}`);
    const paths = Object.keys(settings.projects.value);
    if (paths.length === 0) console.log("projekt-overrides: keine");
    for (const path of paths) console.log(`projekt ${path}: ${JSON.stringify(settings.projects.value[path])}`);
    return;
  }

  let sessionIds: { id: string; label: string }[];
  if (args[0] === "--project") {
    const project = args[1];
    if (!project) usage();
    const sessions = await api<SessionRow[]>("/api/sessions");
    sessionIds = sessions.filter((s) => s.project === project).map((s) => ({ id: s.id, label: s.id }));
    if (sessionIds.length === 0) {
      console.log(`keine Sessions für ${project}`);
      return;
    }
  } else {
    const id = args.find((a) => !a.startsWith("--"));
    if (!id) usage();
    sessionIds = [{ id, label: id }];
  }

  let anyFailure = false;
  for (const { id } of sessionIds) {
    if (apply) {
      const result = await api<MainSyncApplyResult>(`/api/sessions/${id}/main-sync`, { method: "POST", body: "{}" });
      console.log(`${id}: ${formatMainSyncApply(result)}`);
      if (result.outcome === "failed") anyFailure = true;
    } else {
      try {
        const checkResult = await api<MainSyncCheckResult>(`/api/sessions/${id}/main-sync`);
        for (const line of formatMainSyncCheck(checkResult, id)) console.log(line);
      } catch (err) {
        anyFailure = true;
        console.log(`${id}: messung gescheitert (${err instanceof Error ? err.message : String(err)})`);
      }
    }
  }
  if (anyFailure) process.exitCode = 1;
}
