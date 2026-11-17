import { type Team, type TeamTaskStatistics, type TeamTaskStatus } from "@ancientvoid/contracts";

/**
 * P56 T56.1b: Fakten über Teams. `done` ist worker_done und beweist kein
 * bestandenes Gate (P40-Regel) — eine Gate-Erfolgsquote ist nicht belegt.
 * Retries sind belegte Dispatch-Generationen (> 1); eine Session-Fortsetzung
 * erzeugt keine neue Generation und wird nicht zum Retry umgedeutet.
 */
export function aggregateTeamTaskStatistics(teams: readonly Team[]): TeamTaskStatistics {
  if (teams.length === 0) throw new Error("Keine Teams für Statistik.");
  const tasks = teams.flatMap(t => t.tasks);
  const byStatus = (status: TeamTaskStatus) => tasks.filter(t => t.status === status).length;
  const dispatches = tasks.flatMap(t => t.dispatches);
  const tasksWithDispatches = tasks.filter(t => t.dispatches.length > 0);
  const retryTasks = tasksWithDispatches.filter(t => Math.max(...t.dispatches.map(d => d.generation)) > 1).length;
  const done = byStatus("done");
  const failed = byStatus("failed");
  return {
    teams: teams.length,
    tasks: tasks.length,
    open: byStatus("pending") + byStatus("ready") + byStatus("running"),
    unknown: byStatus("unknown"),
    done,
    failed,
    tasksWithDispatches: tasksWithDispatches.length,
    retryTasks,
    retryRate: tasksWithDispatches.length === 0 ? null : retryTasks / tasksWithDispatches.length,
    dispatches: dispatches.length,
    staleDispatches: dispatches.filter(d => d.status === "stale").length,
    workerEndRate: done + failed === 0 ? null : done / (done + failed),
  };
}
