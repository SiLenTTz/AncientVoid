import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, appendFileSync } from "node:fs";
import { resolve } from "node:path";
import type { AutomationDefinition, AutomationClaimState, AutomationSkipReason, AutomationOutcome } from "@ancientvoid/contracts";
import { AutomationDefinition as AutomationDefinitionSchema, automationClaimKey } from "@ancientvoid/contracts";

type DefinitionInput = Parameters<typeof AutomationDefinitionSchema.parse>[0];

/**
 * EPIC-P41 T41.3 (ADR-0064): Journal + Snapshot für Definitionen und Claims
 * (Forge-Store-Muster, K7). Der Claim-Schlüssel ist deterministisch; ein
 * Claim pro Schlüssel. Nach einem Crash wird NIE blind replays — ein Claim in
 * `claimed` ohne Dispatch bleibt unklar, und das ist ein dokumentierter Zustand.
 */

export type JournalEvent =
  | { seq: number; type: "definition"; at: string; definition: AutomationDefinition }
  | { seq: number; type: "claim"; at: string; claimKey: string; automationId: string; generation: number; occurrenceUtc: string }
  | {
      seq: number;
      type: "claim_update";
      at: string;
      claimKey: string;
      state: AutomationClaimState;
      reason?: AutomationSkipReason;
      outcome?: AutomationOutcome;
      runId?: string;
      sessionId?: string;
    };

export interface ClaimState {
  claimKey: string;
  automationId: string;
  generation: number;
  occurrenceUtc: string;
  state: AutomationClaimState;
  reason?: AutomationSkipReason;
  outcome?: AutomationOutcome;
  runId?: string;
  sessionId?: string;
  at: string;
}

interface Snapshot {
  appliedSeq: number;
  definitions: AutomationDefinition[];
  claims: ClaimState[];
}

/** Omit über eine Union muss verteilen, sonst kollabiert es auf die Gemeinsamkeiten. */
type WithoutSeq<T> = T extends unknown ? Omit<T, "seq"> : never;

export class AutomationStore {
  private readonly root: string;
  private readonly definitions = new Map<string, AutomationDefinition>();
  private readonly claims = new Map<string, ClaimState>();
  private seq = 0;
  private skippedLines = 0;

  constructor(root: string) {
    this.root = root;
    this.replay();
  }

  /** K7: Zustand ausschließlich aus Snapshot + Journal. */
  private replay(): void {
    let snapshot: Snapshot = { appliedSeq: 0, definitions: [], claims: [] };
    if (existsSync(resolve(this.root, "snapshot.json"))) {
      try {
        const parsed = JSON.parse(readFileSync(resolve(this.root, "snapshot.json"), "utf8")) as Snapshot;
        if (typeof parsed.appliedSeq === "number") snapshot = parsed;
      } catch {
        snapshot = { appliedSeq: 0, definitions: [], claims: [] };
      }
    }
    for (const d of snapshot.definitions ?? []) this.definitions.set(d.id, d);
    for (const c of snapshot.claims ?? []) this.claims.set(c.claimKey, c);
    this.seq = snapshot.appliedSeq;
    const journalPath = resolve(this.root, "journal.jsonl");
    if (existsSync(journalPath)) {
      for (const line of readFileSync(journalPath, "utf8").split("\n")) {
        if (!line.trim()) continue;
        let event: JournalEvent;
        try {
          event = JSON.parse(line) as JournalEvent;
        } catch {
          this.skippedLines += 1;
          continue;
        }
        if (typeof event.seq !== "number" || event.seq <= snapshot.appliedSeq) continue;
        this.apply(event);
        this.seq = Math.max(this.seq, event.seq);
      }
    }
  }

  private apply(event: JournalEvent): void {
    if (event.type === "definition") {
      this.definitions.set(event.definition.id, event.definition);
      return;
    }
    if (event.type === "claim") {
      if (this.claims.has(event.claimKey)) return; // Dedupe: der erste Claim gewinnt (K7-Replay inklusive).
      this.claims.set(event.claimKey, {
        claimKey: event.claimKey,
        automationId: event.automationId,
        generation: event.generation,
        occurrenceUtc: event.occurrenceUtc,
        state: "claimed",
        at: event.at,
      });
      return;
    }
    const claim = this.claims.get(event.claimKey);
    if (!claim) return;
    claim.state = event.state;
    if (event.reason !== undefined) claim.reason = event.reason;
    if (event.outcome !== undefined) claim.outcome = event.outcome;
    if (event.runId !== undefined) claim.runId = event.runId;
    if (event.sessionId !== undefined) claim.sessionId = event.sessionId;
    claim.at = event.at;
  }

  private append(event: WithoutSeq<JournalEvent>): void {
    mkdirSync(this.root, { recursive: true, mode: 0o700 });
    this.seq += 1;
    const full = { ...event, seq: this.seq } as JournalEvent;
    appendFileSync(resolve(this.root, "journal.jsonl"), `${JSON.stringify(full)}\n`);
    this.apply(full); // der Laufzeit-Spiegel des Journals — sonst lebt der Zustand nur auf der Platte
  }

  /** Neue Definition (Generation 1, deaktiviert); jede wesentliche Änderung erhöht die Generation. */
  upsertDefinition(definition: DefinitionInput, nowIso: string): AutomationDefinition {
    const parsed = AutomationDefinitionSchema.parse(definition) as AutomationDefinition;
    const previous = this.definitions.get(parsed.id);
    const material = previous !== undefined && JSON.stringify({ ...previous, enabled: parsed.enabled }) !== JSON.stringify(parsed);
    const stored: AutomationDefinition = {
      ...parsed,
      generation: previous === undefined ? 1 : material ? previous.generation + 1 : previous.generation,
    };
    this.append({ type: "definition", at: nowIso, definition: stored });
    this.definitions.set(stored.id, stored);
    return stored;
  }

  claim(automationId: string, generation: number, occurrenceUtc: string, nowIso: string): ClaimState | null {
    const key = automationClaimKey(automationId, generation, occurrenceUtc);
    if (this.claims.has(key)) return null;
    this.append({ type: "claim", at: nowIso, claimKey: key, automationId, generation, occurrenceUtc });
    return this.claims.get(key) ?? null;
  }

  updateClaim(claimKey: string, patch: { state: AutomationClaimState; reason?: AutomationSkipReason; outcome?: AutomationOutcome; runId?: string; sessionId?: string }, nowIso: string): ClaimState | null {
    const claim = this.claims.get(claimKey);
    if (!claim) return null;
    this.append({ type: "claim_update", at: nowIso, claimKey, ...patch });
    return this.claims.get(claimKey) ?? null;
  }

  definition(id: string): AutomationDefinition | undefined {
    return this.definitions.get(id);
  }

  listDefinitions(): AutomationDefinition[] {
    return [...this.definitions.values()];
  }

  claimsFor(automationId: string): ClaimState[] {
    return [...this.claims.values()].filter((c) => c.automationId === automationId);
  }

  hasClaim(key: string): boolean {
    return this.claims.has(key);
  }

  /** Offene (nicht abgerechnete) Claims einer Definition — Basis der Überlappungsprüfung. */
  inFlight(automationId: string): number {
    return [...this.claims.values()].filter((c) => c.automationId === automationId && (c.state === "claimed" || c.state === "dispatched")).length;
  }

  saveSnapshot(): void {
    mkdirSync(this.root, { recursive: true, mode: 0o700 });
    const snapshot: Snapshot = { appliedSeq: this.seq, definitions: [...this.definitions.values()], claims: [...this.claims.values()] };
    const path = resolve(this.root, "snapshot.json");
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, JSON.stringify(snapshot, null, 2));
    renameSync(tmp, path);
  }
}
