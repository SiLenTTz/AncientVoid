import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, appendFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * ADR-0094 (EPIC-P73): Journal + Snapshot der Issue-Session-Bridge (K7,
 * AutomationStore-Muster). Dedupe und Lebenstatus liegen hier, nicht im
 * Scheduler: Issue-Nummer → Session-ID → Ergebnis. Nach einem Neustart gilt
 * `dispatched` weiter als laufend und wird wieder inspiziert — nichts geht
 * verloren, nichts wird blind neu versendet.
 */

export type BridgeOutcome = "succeeded" | "failed" | "timeout" | "cancelled" | "unknown";

export type BridgeEntry = {
  issue: number;
  title: string;
  url: string;
  sessionId: string;
  state: "dispatched" | "settled";
  outcome?: BridgeOutcome;
  atUtc: string;
  settledAtUtc?: string;
};

export type JournalEvent =
  | { seq: number; type: "poll"; at: string; throughUtc: string }
  | { seq: number; type: "dispatched"; at: string; issue: number; title: string; url: string; sessionId: string }
  | { seq: number; type: "settled"; at: string; issue: number; outcome: BridgeOutcome }
  | { seq: number; type: "error"; at: string; detail: string };

/** Omit über eine Union muss verteilen, sonst kollabiert sie (Muster AutomationStore). */
type WithoutSeq<T> = T extends unknown ? Omit<T, "seq"> : never;
export type JournalEventInput = WithoutSeq<JournalEvent>;

interface Snapshot {
  appliedSeq: number;
  throughUtc: string | null;
  entries: BridgeEntry[];
  errors: Array<{ at: string; detail: string }>;
}

/** Abgeschlossene Issue-Sessions bleiben sichtbar (Anzeige), aber begrenzt. */
export const BRIDGE_ENTRY_KEEP = 100;
export const BRIDGE_ERROR_KEEP = 20;

export class IssueBridgeJournal {
  private readonly root: string;
  private through: string | null = null;
  private readonly issues = new Map<number, BridgeEntry>();
  private readonly recentErrors: Array<{ at: string; detail: string }> = [];
  private seq = 0;

  constructor(root: string) {
    this.root = root;
    mkdirSync(root, { recursive: true });
    this.replay();
  }

  get throughUtc(): string | null {
    return this.through;
  }

  entry(issue: number): BridgeEntry | undefined {
    return this.issues.get(issue);
  }

  /** Laufende Issue-Sessions — nach Neustart unverändert wieder da (K7). */
  dispatched(): BridgeEntry[] {
    return [...this.issues.values()].filter((e) => e.state === "dispatched").sort((a, b) => a.issue - b.issue);
  }

  recent(): BridgeEntry[] {
    return [...this.issues.values()]
      .sort((a, b) => (b.settledAtUtc ?? b.atUtc).localeCompare(a.settledAtUtc ?? a.atUtc))
      .slice(0, BRIDGE_ENTRY_KEEP);
  }

  errors(): Array<{ at: string; detail: string }> {
    return [...this.recentErrors];
  }

  recordPoll(throughUtc: string, at: string): void {
    this.append({ type: "poll", at, throughUtc });
    this.through = throughUtc;
  }

  recordDispatched(issue: number, title: string, url: string, sessionId: string, at: string): void {
    if (this.issues.has(issue)) return; // Dedupe: max. eine Session je Issue
    this.append({ type: "dispatched", at, issue, title, url, sessionId });
    this.issues.set(issue, { issue, title, url, sessionId, state: "dispatched", atUtc: at });
    this.compactIfNeeded();
  }

  recordSettled(issue: number, outcome: BridgeOutcome, at: string): void {
    const entry = this.issues.get(issue);
    if (!entry || entry.state === "settled") return;
    this.append({ type: "settled", at, issue, outcome });
    entry.state = "settled";
    entry.outcome = outcome;
    entry.settledAtUtc = at;
    this.compactIfNeeded();
  }

  recordError(detail: string, at: string): void {
    const short = detail.slice(0, 500);
    this.append({ type: "error", at, detail: short });
    this.recentErrors.push({ at, detail: short });
    while (this.recentErrors.length > BRIDGE_ERROR_KEEP) this.recentErrors.shift();
  }

  private append(event: JournalEventInput): void {
    const withSeq = { ...event, seq: ++this.seq } as JournalEvent;
    appendFileSync(resolve(this.root, "journal.jsonl"), `${JSON.stringify(withSeq)}\n`);
    this.apply(withSeq, false);
  }

  /** K7: Zustand ausschließlich aus Snapshot + Journal. */
  private replay(): void {
    let snapshot: Snapshot = { appliedSeq: 0, throughUtc: null, entries: [], errors: [] };
    const snapshotPath = resolve(this.root, "snapshot.json");
    if (existsSync(snapshotPath)) {
      try {
        const parsed = JSON.parse(readFileSync(snapshotPath, "utf8")) as Snapshot;
        if (typeof parsed.appliedSeq === "number") snapshot = parsed;
      } catch {
        snapshot = { appliedSeq: 0, throughUtc: null, entries: [], errors: [] };
      }
    }
    this.seq = snapshot.appliedSeq;
    this.through = snapshot.throughUtc;
    for (const e of snapshot.entries) this.issues.set(e.issue, e);
    this.recentErrors.push(...(snapshot.errors ?? []).slice(-BRIDGE_ERROR_KEEP));
    const journalPath = resolve(this.root, "journal.jsonl");
    if (existsSync(journalPath)) {
      for (const line of readFileSync(journalPath, "utf8").split("\n")) {
        if (!line.trim()) continue;
        try {
          this.apply(JSON.parse(line) as JournalEvent, true);
        } catch {
          // kaputte Zeile: übernehmen was geht, K7-Rest kommt aus dem Snapshot
        }
      }
    }
  }

  private apply(event: JournalEvent, replay: boolean): void {
    if (replay) {
      if (event.seq <= this.seq) return;
      this.seq = event.seq;
    }
    switch (event.type) {
      case "poll":
        this.through = event.throughUtc;
        return;
      case "dispatched":
        if (!this.issues.has(event.issue)) {
          this.issues.set(event.issue, { issue: event.issue, title: event.title, url: event.url, sessionId: event.sessionId, state: "dispatched", atUtc: event.at });
        }
        return;
      case "settled": {
        const entry = this.issues.get(event.issue);
        if (entry && entry.state !== "settled") {
          entry.state = "settled";
          entry.outcome = event.outcome;
          entry.settledAtUtc = event.at;
        }
        return;
      }
      case "error":
        this.recentErrors.push({ at: event.at, detail: event.detail });
        while (this.recentErrors.length > BRIDGE_ERROR_KEEP) this.recentErrors.shift();
        return;
    }
  }

  /** Snapshot schreibt das Journal nicht neu (append-only bleibt), kürzt nur den Speicher. */
  private compactIfNeeded(): void {
    if (this.issues.size <= BRIDGE_ENTRY_KEEP * 2) return;
    const keep = new Set(this.recent().map((e) => e.issue));
    for (const issue of [...this.issues.keys()]) if (!keep.has(issue)) this.issues.delete(issue);
    this.writeSnapshot();
  }

  private writeSnapshot(): void {
    const snapshot: Snapshot = {
      appliedSeq: this.seq,
      throughUtc: this.through,
      entries: this.recent(),
      errors: this.recentErrors.slice(-BRIDGE_ERROR_KEEP),
    };
    const path = resolve(this.root, "snapshot.json");
    const tmp = resolve(this.root, "snapshot.json.tmp");
    writeFileSync(tmp, `${JSON.stringify(snapshot)}\n`);
    renameSync(tmp, path);
  }
}
