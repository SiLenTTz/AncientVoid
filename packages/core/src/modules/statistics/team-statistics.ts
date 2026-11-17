import { TeamTaskStatistics, type Team, type TeamTaskStatus } from "@ancientvoid/contracts";

/** Additive Zähl-Fakten eines Teams — Grundlage für Cache (T56.2) und Summierung. */
export interface TeamTaskCounts {
  tasks: number;
  openTasks: number;
  unknownTasks: number;
  doneTasks: number;
  failedTasks: number;
  tasksWithDispatches: number;
  retryTasks: number;
  dispatches: number;
  staleDispatches: number;
}

export function teamTaskCounts(team: Team): TeamTaskCounts {
  const tasks = team.tasks;
  const byStatus = (status: TeamTaskStatus) => tasks.filter(t => t.status === status).length;
  const dispatches = tasks.flatMap(t => t.dispatches);
  const tasksWithDispatches = tasks.filter(t => t.dispatches.length > 0);
  return {
    tasks: tasks.length,
    openTasks: byStatus("pending") + byStatus("ready") + byStatus("running"),
    unknownTasks: byStatus("unknown"),
    doneTasks: byStatus("done"),
    failedTasks: byStatus("failed"),
    tasksWithDispatches: tasksWithDispatches.length,
    retryTasks: tasksWithDispatches.filter(t => Math.max(...t.dispatches.map(d => d.generation)) > 1).length,
    dispatches: dispatches.length,
    staleDispatches: dispatches.filter(d => d.status === "stale").length,
  };
}

/** Summiert Zähl-Fakten zu einer Statistik; null wenn nichts belegt ist. */
export function sumTeamTaskCounts(teams: number, counts: readonly TeamTaskCounts[]): TeamTaskStatistics | null {
  if (counts.length === 0) return null;
  const sum = (pick: keyof TeamTaskCounts) => counts.reduce((acc, c) => acc + c[pick], 0);
  const done = sum("doneTasks");
  const failed = sum("failedTasks");
  const tasksWithDispatches = sum("tasksWithDispatches");
  const retryTasks = sum("retryTasks");
  return TeamTaskStatistics.parse({
    teams,
    tasks: sum("tasks"),
    open: sum("openTasks"),
    unknown: sum("unknownTasks"),
    done,
    failed,
    tasksWithDispatches,
    retryTasks,
    retryRate: tasksWithDispatches === 0 ? null : retryTasks / tasksWithDispatches,
    dispatches: sum("dispatches"),
    staleDispatches: sum("staleDispatches"),
    workerEndRate: done + failed === 0 ? null : done / (done + failed),
  });
}

/**
 * P56 T56.1b: Fakten über Teams. `done` ist worker_done und beweist kein
 * bestandenes Gate (P40-Regel) — eine Gate-Erfolgsquote ist nicht belegt.
 * Retries sind belegte Dispatch-Generationen (> 1); eine Session-Fortsetzung
 * erzeugt keine neue Generation und wird nicht zum Retry umgedeutet.
 */
export function aggregateTeamTaskStatistics(teams: readonly Team[]): TeamTaskStatistics {
  if (teams.length === 0) throw new Error("Keine Teams für Statistik.");
  return sumTeamTaskCounts(teams.length, teams.map(teamTaskCounts))!;
}
