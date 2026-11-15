import { TeamStore, TeamCoordinator, type TeamSessionPort, type SessionManager } from "@ancientvoid/core";

export interface HubTeam {
  store: TeamStore;
  coordinator: TeamCoordinator;
  ready: Promise<void>;
}

/** P40/P41 teilen einen Ausführungseigentümer (ADR-0065); Run→Team umbenannt in EPIC-P60 (ADR-0077). */
export function createHubTeam(deps: { sessions: SessionManager; dataDir?: string }): HubTeam {
  const port: TeamSessionPort = {
    async create(spec, actor) {
      const record = await deps.sessions.create(
        {
          adapter: spec.adapter,
          project: spec.project,
          prompt: spec.prompt,
          ...(spec.model ? { model: spec.model } : {}),
          ...(spec.workspaceMode ? { workspaceMode: spec.workspaceMode } : {}),
          ...(spec.title ? { title: spec.title } : {}),
        },
        actor,
      );
      return { id: record.id };
    },
    async steer(sessionId, prompt, actor) {
      return deps.sessions.steer(sessionId, { kind: "prompt", text: prompt }, actor);
    },
    async stop(sessionId, actor) {
      return deps.sessions.stop(sessionId, actor);
    },
    async status(sessionId) {
      return deps.sessions.get(sessionId)?.status ?? null;
    },
    async lastAssistant(sessionId) {
      if (!deps.sessions.get(sessionId)) return null;
      const events = await deps.sessions.tail(sessionId, 0, 10_000);
      let last: string | null = null;
      for (const e of events) {
        if (e.type !== "assistant") continue;
        const raw = (e.payload as { text?: unknown }).text;
        // Nicht jeder Harness schreibt payload.text (dummy: n/adapter) — die
        // Event-Summary ist die ehrliche Ergebnisvorschau, nie erfunden.
        last = typeof raw === "string" ? raw : (e.summary ?? "(Assistant-Antwort ohne Text)");
      }
      if (last === null) return null;
      return { text: last, bytes: Buffer.byteLength(last, "utf8"), blobRef: null };
    },
    async writeBlob(sessionId, text) {
      return deps.sessions.writeBlobRef(sessionId, text);
    },
  };

  const store = new TeamStore(deps.dataDir ?? ".");
  const coordinator = new TeamCoordinator(store, port, { pollMs: 2000 });
  const ready = store.init().then(() => coordinator.recover()).then(() => coordinator.startLoop());
  return { store, coordinator, ready };
}
