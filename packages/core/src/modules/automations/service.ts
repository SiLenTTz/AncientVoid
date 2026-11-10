import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  AutomationDefinition as DefinitionSchema,
  type AutomationDefinition,
  type AutomationInfo,
  type AutomationOutcome,
} from "@ancientvoid/contracts";
import { AutomationStore, type ClaimState } from "./store.ts";
import { AutomationsScheduler, type DispatchResult, type PrecheckResult } from "./scheduler.ts";
import { nextOccurrences } from "./schedule.ts";

/**
 * EPIC-P41 T41.4: Dienst über Store und Scheduler. Launcher und Prechecker sind
 * injectable — die Kernschicht kennt weder SessionManager noch Prozessstart.
 * Neue Definitionen beginnen deaktiviert; jede wesentliche Änderung invalidiert
 * die alte Freigabe (Generation++ und deaktiviert, ADR-0064).
 */

type DefinitionInput = Parameters<typeof DefinitionSchema.parse>[0];
// zod4: parse nimmt unknown — die Routen reichen bereits validierte Definitionen durch.

export interface AutomationLauncher {
  /** Start beim Ausführungseigentümer. `dispatched` heißt Startauftrag, nie Erfolg. */
  launch(definition: AutomationDefinition, promptText: string | null, claimKey: string, kind: "due" | "run_now" | "catchup"): Promise<DispatchResult>;
}

export interface AutomationPrechecker {
  /** null = erfüllt; sonst der getrennte Grund (precheck_exit/precheck_timeout/auth/quota/lease/host_down). */
  run(actionId: string, definition: AutomationDefinition, deadlineMs: number): Promise<PrecheckResult>;
}

export interface AutomationServiceDeps {
  root: string;
  hostId: string;
  launcher: AutomationLauncher;
  prechecker: AutomationPrechecker;
  now?: () => number;
  log?: (line: string) => void;
}

export class AutomationService {
  private readonly store: AutomationStore;
  private readonly scheduler: AutomationsScheduler;
  private readonly blobRoot: string;
  private readonly launcher: AutomationLauncher;
  private readonly prechecker: AutomationPrechecker;
  private readonly now: () => number;
  private readonly log: (line: string) => void;

  constructor(deps: AutomationServiceDeps) {
    this.blobRoot = resolve(deps.root, "blobs");
    this.launcher = deps.launcher;
    this.prechecker = deps.prechecker;
    this.now = deps.now ?? (() => Date.now());
    this.log = deps.log ?? (() => undefined);
    this.store = new AutomationStore(deps.root);
    this.scheduler = new AutomationsScheduler({
      store: this.store,
      hostId: deps.hostId,
      now: this.now,
      precheck: (definition, deadlineMs) => this.prechecker.run(definition.precheckActionId!, definition, deadlineMs),
      dispatch: (definition, claimKey, occurrenceUtc, kind) => this.launcher.launch(definition, definition.target.kind === "session" ? this.blobText(definition.target.promptBlobSha256) : null, claimKey, kind),
    });
  }

  start(): void {
    this.scheduler.start();
  }

  stop(): void {
    this.scheduler.stop();
  }

  list(): AutomationInfo[] {
    const nowIso = new Date(this.now()).toISOString();
    return this.store.listDefinitions().map((definition) => {
      const claims = this.store.claimsFor(definition.id);
      const last = claims.reduce<ClaimState | null>((max, c) => (max === null || c.at > max.at ? c : max), null);
      return {
        definition,
        nextOccurrences: nextOccurrences(definition.schedule, nowIso, 5).map((o) => ({ utc: o.utc, local: o.local })),
        lastOccurrence: last === null ? null : { utc: last.occurrenceUtc, state: last.state, ...(last.reason ? { reason: last.reason } : {}), ...(last.outcome ? { outcome: last.outcome } : {}), ...(last.runId ? { runId: last.runId } : {}), ...(last.sessionId ? { sessionId: last.sessionId } : {}) },
      };
    });
  }

  history(id: string): ClaimState[] {
    return this.store.claimsFor(id).sort((a, b) => b.at.localeCompare(a.at));
  }

  /** Neue Definition: immer deaktiviert — die Aktivierung ist die menschliche Freigabe. */
  create(input: DefinitionInput, promptText?: string): AutomationDefinition {
    const definition = DefinitionSchema.parse(input);
    definition.enabled = false;
    this.storeDefinition(definition, promptText, true);
    return this.store.definition(definition.id)!;
  }

  /** Wesentliche Änderung = neue Generation = alte Freigabe invalidiert (ADR-0064). */
  update(id: string, input: DefinitionInput, promptText?: string): AutomationDefinition | null {
    const previous = this.store.definition(id);
    if (!previous) return null;
    const next = DefinitionSchema.parse({ ...(input as object), id: previous.id }) as AutomationDefinition;
    this.validatePrompt(next, promptText, false);
    const material = JSON.stringify({ ...previous, enabled: next.enabled, generation: previous.generation }) !== JSON.stringify({ ...next, generation: previous.generation });
    const stored = this.store.upsertDefinition(material ? { ...next, enabled: false } : next, new Date(this.now()).toISOString());
    return stored;
  }

  /** Die Freigabe selbst: sie invalidiert sich nicht selbst (kein Generation++ bei reinem Enable). */
  setEnabled(id: string, enabled: boolean): AutomationDefinition | null {
    const previous = this.store.definition(id);
    if (!previous) return null;
    return this.store.upsertDefinition({ ...previous, enabled }, new Date(this.now()).toISOString());
  }

  async runNow(id: string): Promise<ClaimState | null> {
    return this.scheduler.runNow(id);
  }

  /** Der Mensch rechnet das Ergebnis des referenzierten Laufs ab (Spiegel, K7). */
  settle(claimKey: string, outcome: AutomationOutcome): ClaimState | null {
    return this.scheduler.settle(claimKey, outcome);
  }

  private storeDefinition(definition: AutomationDefinition, promptText: string | undefined, isNew: boolean): void {
    this.validatePrompt(definition, promptText, isNew);
    this.store.upsertDefinition(definition, new Date(this.now()).toISOString());
  }

  private validatePrompt(definition: AutomationDefinition, promptText: string | undefined, isNew: boolean): void {
    if (definition.target.kind === "session") {
      if (isNew && promptText === undefined) throw new Error("Session-Ziel ohne Prompt-Text: der Blob-Abgleich ist nicht möglich.");
      if (promptText !== undefined) {
        const sha = createHash("sha256").update(promptText).digest("hex");
        if (sha !== definition.target.promptBlobSha256) throw new Error(`Prompt-Blob passt nicht zur Definition: ${sha} != ${definition.target.promptBlobSha256}`);
        this.writeBlob(promptText);
      } else if (this.blobText(definition.target.promptBlobSha256) === null) {
        throw new Error("Prompt-Blob fehlt: Update braucht den passenden Prompt-Text.");
      }
    }
  }

  private writeBlob(text: string): void {
    const sha = createHash("sha256").update(text).digest("hex");
    mkdirSync(this.blobRoot, { recursive: true, mode: 0o700 });
    const path = resolve(this.blobRoot, `${sha}.txt`);
    if (!existsSync(path)) writeFileSync(path, text, { mode: 0o600 });
  }

  private blobText(sha: string): string | null {
    const path = resolve(this.blobRoot, `${sha}.txt`);
    if (!existsSync(path)) return null;
    const text = readFileSync(path, "utf8");
    if (createHash("sha256").update(text).digest("hex") !== sha) throw new Error(`Prompt-Blob ${sha} ist verstümmelt — Fail loud, nicht raten.`);
    return text;
  }
}
