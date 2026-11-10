import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { OrchestrationRun} from "@ancientvoid/contracts";
import { type OrchestrationRunStatus } from "@ancientvoid/contracts";

/**
 * EPIC-P40 (ADR-0064 §5): Orchestrierungs-Store nach dem Reviews-Muster (K7) —
 * Journal (`runs.jsonl`) + Snapshot (`snapshot.json`) pro Hub-Datenverzeichnis,
 * keine SQLite-Insel. Restore = Snapshot + Journal-Nachlauf; kaputte Zeilen werden
 * gezählt und übersprungen, nie versteckt.
 */

export interface OrchestrationRecoveryReport {
  runs: number;
  skippedLines: number;
}

interface JournalLine {
  seq: number;
  at: string;
  op: "put";
  run: OrchestrationRun;
}

interface Snapshot {
  appliedSeq: number;
  runs: OrchestrationRun[];
}

export class OrchestrationStore {
  private readonly dir: string;
  private seq = 0;
  private runs = new Map<string, OrchestrationRun>();

  constructor(dataDir: string) {
    this.dir = join(dataDir, "orchestration");
  }

  async init(): Promise<OrchestrationRecoveryReport> {
    await mkdir(this.dir, { recursive: true });
    const skippedLines = { n: 0 };
    const snapPath = join(this.dir, "snapshot.json");
    if (existsSync(snapPath)) {
      try {
        const snap = JSON.parse(await readFile(snapPath, "utf8")) as Snapshot;
        this.seq = snap.appliedSeq;
        for (const r of snap.runs) this.runs.set(r.id, r);
      } catch {
        // Kaputter Snapshot: Journal ist die Wahrheit — von Null nachlaufen.
        this.seq = 0;
        this.runs.clear();
      }
    }
    const journalPath = join(this.dir, "runs.jsonl");
    if (existsSync(journalPath)) {
      const raw = await readFile(journalPath, "utf8");
      for (const line of raw.split("\n")) {
        if (line.trim() === "") continue;
        try {
          const entry = JSON.parse(line) as JournalLine;
          if (entry.seq <= this.seq) continue;
          this.runs.set(entry.run.id, entry.run);
          this.seq = entry.seq;
        } catch {
          skippedLines.n++;
        }
      }
    }
    return { runs: this.runs.size, skippedLines: skippedLines.n };
  }

  list(): OrchestrationRun[] {
    return [...this.runs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  get(id: string): OrchestrationRun | undefined {
    return this.runs.get(id);
  }

  /** Schreib-Queue: Updates serialisieren — parallele FileWriter auf Journal/Snapshot
   * derselben Instanz würden sich gegenseitig Dateien wegrenamen. */
  private writes: Promise<unknown> = Promise.resolve();

  /** Mutiert einen Run über die Funktion und persistiert Journal+Snapshot atomar. */
  update(id: string, mutate: (run: OrchestrationRun) => void): Promise<OrchestrationRun | null> {
    const next = this.writes.then(() => this.writeNow(id, mutate));
    this.writes = next.catch(() => undefined);
    return next;
  }

  private async writeNow(id: string, mutate: (run: OrchestrationRun) => void): Promise<OrchestrationRun | null> {
    const run = this.runs.get(id);
    if (!run) return null;
    mutate(run);
    // Verzeichnis idempotent sicherstellen: update kann vor dem asynchronen init() laufen.
    await mkdir(this.dir, { recursive: true });
    const entry: JournalLine = { seq: ++this.seq, at: new Date().toISOString(), op: "put", run };
    await writeFile(join(this.dir, "runs.jsonl"), JSON.stringify(entry) + "\n", { flag: "a" });
    const snap: Snapshot = { appliedSeq: this.seq, runs: [...this.runs.values()] };
    const tmp = join(this.dir, `.snapshot-${process.pid}-${this.seq}.tmp`);
    await writeFile(tmp, JSON.stringify(snap));
    await rename(tmp, join(this.dir, "snapshot.json"));
    return run;
  }
  async put(run: OrchestrationRun): Promise<OrchestrationRun> {
    this.runs.set(run.id, run);
    await this.update(run.id, () => undefined);
    return run;
  }

  /** Sichtbarkeit für Tests/Recovery: Zustand nach Restore. */
  statuses(): Map<string, OrchestrationRunStatus> {
    const out = new Map<string, OrchestrationRunStatus>();
    for (const r of this.runs.values()) out.set(r.id, r.status);
    return out;
  }
}
