import type { MainSyncSettings } from "@ancientvoid/contracts";
import type { MainSyncApplyResult } from "@ancientvoid/contracts";
import { MainSyncEngine } from "./main-sync-engine.ts";
import { fetchMainBranch, resolveMainBranch } from "./main-sync-git.ts";

/** Was der Scheduler über eine Sync-fähige Session wissen muss (SessionManager liefert das). */
export interface MainSyncCandidate {
  sessionId: string;
  projectPath: string;
  workdir: string;
  /** Gating AC-P67-6: nur wartende Sessions werden jemals gemergt. */
  waiting: boolean;
}

/** Debounce-Zustand je Session — bewusst nur im Speicher (K7: kein persistenter Timer). */
interface SeenState {
  behind: number;
  /** zuletzt gemeldeter Fetch-/Probelauf-Fehler — gleicher Fehler meldet sich nicht je Takt neu. */
  failure?: string;
}

/** Was der Scheduler nach draußen meldet — T67.6 macht daraus Hub-Benachrichtigungen + Push. */
export type MainSyncSchedulerNotice =
  | { kind: "behind"; sessionId: string; projectPath: string; behind: number; branch: string }
  | { kind: "conflict"; sessionId: string; projectPath: string; files: string[] }
  | { kind: "applied"; sessionId: string; projectPath: string; result: Extract<MainSyncApplyResult, { outcome: "applied" }> }
  | { kind: "failed"; sessionId: string; projectPath: string; reason: string; detail?: string };

export interface MainSyncSchedulerDeps {
  /** Effektive Einstellungen je Projekt (Defaults ← global ← Override). */
  settingsFor: (projectPath: string) => MainSyncSettings;
  /** Live-Sessions mit Worktree-Isolation (SessionManager.mainSyncCandidates). */
  candidates: () => MainSyncCandidate[];
  /** Merge ausführen — SessionManager.mainSyncApply(sessionId, { skipFetch: true }), Gating inklusive. */
  apply: (sessionId: string) => Promise<MainSyncApplyResult>;
  notice: (n: MainSyncSchedulerNotice) => void;
  now?: () => Date;
  /** Takt des Timers in ms (Production 30 s; Tests treiben tick() direkt). */
  pollMs?: number;
  /** Fetch — injizierbar für den K8-Nachweis (ein Fetch je Projekt); Standard der echte harte Fetch. */
  fetch?: (projectPath: string, branch: string, timeoutSec: number) => Promise<void>;
}

/**
 * EPIC-P67 / ADR-0088 T67.5: ein Takt, ein Fetch — je Projekt, nicht je
 * Session (K8). Der Timer-Zustand (zuletzt gelaufen, bereits gemeldet)
 * lebt nur im Speicher: Beim Hub-Start wird einmal nachgeholt, danach
 * gelten die Intervalle — kein Recovery-Aufwand, kein driftender Zustand
 * (K7, Premortem 7). Modi bei `behind > 0`:
 *
 * - `notify`: Meldung „N hinter main" — je Session einmal pro behind-Stand,
 *   nicht je Takt (Premortem 5).
 * - `auto` + `autoMerge: clean-only`: Probelauf sauber → Merge auf
 *   wartender Session (Gating macht mainSyncApply, AC-P67-6); Konflikt →
 *   Meldung mit Dateiliste.
 * - `auto` + `autoMerge: off|ask` und `behindAction: ask`: nur melden —
 *   autonomes Mergen ohne ausdrückliche Wahl gibt es nicht (ADR-0088 §6).
 */
export class MainSyncScheduler {
  private readonly deps: MainSyncSchedulerDeps;
  private readonly now: () => Date;
  private readonly pollMs: number;
  private readonly fetch: (projectPath: string, branch: string, timeoutSec: number) => Promise<void>;
  private readonly lastRun = new Map<string, number>();
  private readonly seen = new Map<string, SeenState>();
  private readonly running = new Set<string>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticking: Promise<void> | null = null;

  constructor(deps: MainSyncSchedulerDeps) {
    this.deps = deps;
    this.now = deps.now ?? (() => new Date());
    this.pollMs = deps.pollMs ?? 30_000;
    this.fetch = deps.fetch ?? fetchMainBranch;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), this.pollMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Ein Takt: fällige Projekte prüfen — ein Fetch je Projekt, dann je Session messen und handeln. */
  async tick(): Promise<void> {
    if (this.ticking) return this.ticking; // gleichzeitige Läufe zusammenfassen (§3.4)
    this.ticking = this.runDueProjects().finally(() => {
      this.ticking = null;
    });
    return this.ticking;
  }

  private async runDueProjects(): Promise<void> {
    const byProject = new Map<string, MainSyncCandidate[]>();
    for (const candidate of this.deps.candidates()) {
      const list = byProject.get(candidate.projectPath) ?? [];
      list.push(candidate);
      byProject.set(candidate.projectPath, list);
    }
    const nowMs = this.now().getTime();
    await Promise.all(
      [...byProject.entries()].map(async ([projectPath, sessions]) => {
        const settings = this.deps.settingsFor(projectPath);
        if (settings.checkIntervalMin === 0) return; // aus — kein Fetch, kein Takt
        const intervalMs = settings.checkIntervalMin * 60_000;
        const last = this.lastRun.get(projectPath) ?? 0;
        if (nowMs - last < intervalMs) return;
        if (this.running.has(projectPath)) return; // zusammenfassen
        this.running.add(projectPath);
        try {
          await this.runProject(projectPath, sessions, settings);
        } finally {
          this.lastRun.set(projectPath, this.now().getTime());
          this.running.delete(projectPath);
        }
      }),
    );
  }

  private async runProject(projectPath: string, sessions: MainSyncCandidate[], settings: MainSyncSettings): Promise<void> {
    let branch: string;
    try {
      branch = await resolveMainBranch(projectPath, settings);
    } catch {
      return; // kein Git/kein Remote: Stufe 1 meldet das beim Start, hier gibt es nichts zu holen
    }
    try {
      await this.fetch(projectPath, branch, settings.fetchTimeoutSec);
    } catch {
      // Fetch gescheitert: je Session einmal je Fehlerlage melden (Premortem 5), beim nächsten Takt erneut versuchen
      for (const s of sessions) {
        const seen = this.seen.get(s.sessionId);
        const failure = "fetch-failed";
        if (seen?.failure === failure) continue;
        this.seen.set(s.sessionId, { behind: seen?.behind ?? 0, failure });
        this.deps.notice({ kind: "failed", sessionId: s.sessionId, projectPath, reason: failure, detail: `Fetch von origin/${branch} gescheitert` });
      }
      return;
    }
    const engine = new MainSyncEngine({ now: this.now });
    for (const session of sessions) {
      await this.runSession(session, engine, branch, settings);
    }
  }

  private async runSession(session: MainSyncCandidate, engine: MainSyncEngine, branch: string, settings: MainSyncSettings): Promise<void> {
    let behind: number;
    try {
      const measure = await engine.measure(session.workdir, branch);
      behind = measure.behind;
    } catch {
      return; // Worktree weg/kaputt: Recovery der Session ist deren eigene Aufgabe
    }
    const previous = this.seen.get(session.sessionId);
    if (behind === 0) {
      this.seen.delete(session.sessionId); // Stand aktuell — der nächste Rückstand meldet sich wieder
      return;
    }
    const action = effectiveBehindAction(settings);
    if (action !== "auto") {
      this.notifyBehindOnce(session, branch, behind, previous);
      return;
    }
    // auto: Mergen nur bei wartender Session und (im ersten Wurf) nur konfliktfrei
    if (!session.waiting) {
      this.notifyBehindOnce(session, branch, behind, previous);
      return;
    }
    if (settings.autoMerge !== "clean-only") {
      this.notifyBehindOnce(session, branch, behind, previous);
      return;
    }
    let clean: boolean;
    let conflicts: string[];
    try {
      const dry = await engine.dryRun(session.workdir, branch);
      clean = dry.clean;
      conflicts = dry.conflicts;
    } catch {
      this.deps.notice({ kind: "failed", sessionId: session.sessionId, projectPath: session.projectPath, reason: "dry-run-failed" });
      return;
    }
    if (!clean) {
      this.seen.set(session.sessionId, { behind });
      this.deps.notice({ kind: "conflict", sessionId: session.sessionId, projectPath: session.projectPath, files: conflicts });
      return;
    }
    const result = await this.deps.apply(session.sessionId);
    if (result.outcome === "applied") {
      this.seen.delete(session.sessionId);
      this.deps.notice({ kind: "applied", sessionId: session.sessionId, projectPath: session.projectPath, result });
    } else if (result.outcome === "failed") {
      this.deps.notice({ kind: "failed", sessionId: session.sessionId, projectPath: session.projectPath, reason: result.reason, ...(result.detail ? { detail: result.detail } : {}) });
    } else {
      // skipped/conflict (z. B. doch dirty geworden): beim nächsten Takt erneut bewerten
      this.notifyBehindOnce(session, branch, behind, previous);
    }
  }

  /** Premortem 5: eine Meldung je Session und behind-Stand — nicht je Takt. */
  private notifyBehindOnce(session: MainSyncCandidate, branch: string, behind: number, previous: SeenState | undefined): void {
    if (previous && previous.behind === behind) return;
    this.seen.set(session.sessionId, { behind });
    this.deps.notice({ kind: "behind", sessionId: session.sessionId, projectPath: session.projectPath, behind, branch });
  }
}

/** auto hinter `autoMerge` zurück: ohne ausdrückliches clean-only wird nichts autonom gemergt. */
function effectiveBehindAction(settings: MainSyncSettings): "notify" | "auto" {
  if (settings.behindAction === "auto" && settings.autoMerge === "clean-only") return "auto";
  return "notify";
}
