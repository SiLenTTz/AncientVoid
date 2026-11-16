import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Team } from "@ancientvoid/contracts";
import { type TeamStatus } from "@ancientvoid/contracts";

/**
 * EPIC-P40 (ADR-0064 §5), EPIC-P60 (ADR-0077): Team-Store nach dem
 * Reviews-Muster (K7) — Journal (`teams.jsonl`) + Snapshot (`snapshot.json`)
 * pro Hub-Datenverzeichnis, keine SQLite-Insel. Restore = Snapshot +
 * Journal-Nachlauf; kaputte Zeilen werden gezählt und übersprungen, nie
 * versteckt. Beim ersten Start wird ein Altbestand aus `orchestration/`
 * (Runs, bis P60) einmalig migriert; die alten Dateien bleiben liegen.
 */

export interface TeamRecoveryReport {
  teams: number;
  skippedLines: number;
  /** ADR-0077-Migration: Anzahl aus `orchestration/` übernommener Teams (nur beim migrierenden Start gesetzt). */
  migratedTeams?: number;
  migratedSkippedLines?: number;
}

interface JournalLine {
  seq: number;
  at: string;
  op: "put";
  run: Team;
}

interface Snapshot {
  appliedSeq: number;
  runs: Team[];
}

/** ADR-0077 §6: Bestands-Teams bis P60 tragen `frame.model` statt `frame.models` —
 *  beim Laden normalisieren (model m → models [m], null/fehlend → []), damit
 *  Journal + Snapshot in der neuen Form weiterlaufen (K7). */
function normalizeTeam(raw: Team): Team {
  const frame = raw.frame as unknown as { model?: string | null; models?: string[] };
  if (frame.models === undefined) {
    const { model: _legacy, ...rest } = frame;
    raw.frame = { ...rest, models: typeof _legacy === "string" && _legacy.length > 0 ? [_legacy] : [] } as Team["frame"];
  }
  return raw;
}

interface Loaded {
  runs: Map<string, Team>;
  seq: number;
  skippedLines: number;
  /** Journal existierte (entscheidet, ob eine Migration sinnvoll ist). */
  hasJournal: boolean;
}

export class TeamStore {
  private readonly dir: string;
  private readonly legacyDir: string;
  private seq = 0;
  private runs = new Map<string, Team>();

  constructor(dataDir: string) {
    this.dir = join(dataDir, "team");
    this.legacyDir = join(dataDir, "orchestration");
  }

  async init(): Promise<TeamRecoveryReport> {
    await mkdir(this.dir, { recursive: true });
    const loaded = await this.loadDir(this.dir);
    this.runs = loaded.runs;
    this.seq = loaded.seq;
    // ADR-0077: einmalige Migration des Run-Altbestands, solange im neuen
    // Verzeichnis noch kein Journal liegt — danach nie wieder (kein Doppelimport).
    let migratedTeams: number | undefined;
    let migratedSkippedLines: number | undefined;
    if (!loaded.hasJournal && existsSync(this.legacyDir)) {
      const legacy = await this.loadDir(this.legacyDir);
      if (legacy.runs.size > 0 || legacy.seq > 0) {
        // Übernahme als teams.jsonl-Zeilen (einmaliges Weiterschreiben, K7), danach Snapshot.
        this.seq = Math.max(this.seq, legacy.seq);
        for (const r of legacy.runs.values()) {
          this.runs.set(r.id, r);
          const entry: JournalLine = { seq: ++this.seq, at: new Date().toISOString(), op: "put", run: r };
          await writeFile(join(this.dir, "teams.jsonl"), JSON.stringify(entry) + "\n", { flag: "a" });
        }
        await this.persistSnapshot();
        migratedTeams = legacy.runs.size;
        migratedSkippedLines = legacy.skippedLines;
      }
    }
    const report: TeamRecoveryReport = { teams: this.runs.size, skippedLines: loaded.skippedLines };
    if (migratedTeams !== undefined) {
      report.migratedTeams = migratedTeams;
      report.migratedSkippedLines = migratedSkippedLines ?? 0;
    }
    return report;
  }

  /** Snapshot + Journal eines Verzeichnisses lesen (kaputter Snapshot → Journal als Wahrheit). */
  private async loadDir(dir: string): Promise<Loaded> {
    const runs = new Map<string, Team>();
    let seq = 0;
    let skippedLines = 0;
    const snapPath = join(dir, "snapshot.json");
    if (existsSync(snapPath)) {
      try {
        const snap = JSON.parse(await readFile(snapPath, "utf8")) as Snapshot;
        seq = snap.appliedSeq;
        for (const r of snap.runs) runs.set(r.id, normalizeTeam(r));
      } catch {
        // Kaputter Snapshot: Journal ist die Wahrheit — von Null nachlaufen.
        seq = 0;
        runs.clear();
      }
    }
    const journalPath = join(dir, "teams.jsonl");
    const legacyJournalPath = join(dir, "runs.jsonl");
    const journalPathFinal = existsSync(journalPath) ? journalPath : existsSync(legacyJournalPath) ? legacyJournalPath : null;
    if (journalPathFinal) {
      const raw = await readFile(journalPathFinal, "utf8");
      for (const line of raw.split("\n")) {
        if (line.trim() === "") continue;
        try {
          const entry = JSON.parse(line) as JournalLine;
          if (entry.seq <= seq) continue;
          runs.set(entry.run.id, normalizeTeam(entry.run));
          seq = entry.seq;
        } catch {
          skippedLines++;
        }
      }
    }
    return { runs, seq, skippedLines, hasJournal: journalPathFinal !== null };
  }

  list(): Team[] {
    return [...this.runs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  get(id: string): Team | undefined {
    return this.runs.get(id);
  }

  /** Schreib-Queue: Updates serialisieren — parallele FileWriter auf Journal/Snapshot
   * derselben Instanz würden sich gegenseitig Dateien wegrenamen. */
  private writes: Promise<unknown> = Promise.resolve();

  /** Mutiert ein Team über die Funktion und persistiert Journal+Snapshot atomar. */
  update(id: string, mutate: (team: Team) => void): Promise<Team | null> {
    const next = this.writes.then(() => this.writeNow(id, mutate));
    this.writes = next.catch(() => undefined);
    return next;
  }

  private async writeNow(id: string, mutate: (team: Team) => void): Promise<Team | null> {
    const team = this.runs.get(id);
    if (!team) return null;
    mutate(team);
    // Verzeichnis idempotent sicherstellen: update kann vor dem asynchronen init() laufen.
    await mkdir(this.dir, { recursive: true });
    const entry: JournalLine = { seq: ++this.seq, at: new Date().toISOString(), op: "put", run: team };
    await writeFile(join(this.dir, "teams.jsonl"), JSON.stringify(entry) + "\n", { flag: "a" });
    await this.persistSnapshot();
    return team;
  }

  private async persistSnapshot(): Promise<void> {
    const snap: Snapshot = { appliedSeq: this.seq, runs: [...this.runs.values()] };
    const tmp = join(this.dir, `.snapshot-${process.pid}-${this.seq}.tmp`);
    await writeFile(tmp, JSON.stringify(snap));
    await rename(tmp, join(this.dir, "snapshot.json"));
  }

  async put(team: Team): Promise<Team> {
    this.runs.set(team.id, team);
    await this.update(team.id, () => undefined);
    return team;
  }

  /** Sichtbarkeit für Tests/Recovery: Zustand nach Restore. */
  statuses(): Map<string, TeamStatus> {
    const out = new Map<string, TeamStatus>();
    for (const r of this.runs.values()) out.set(r.id, r.status);
    return out;
  }
}
