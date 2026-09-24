import { useEffect, useRef, useState } from "preact/hooks";
import type { AttachmentRecord, HubApi, SessionDraft } from "../../shared/api.ts";

/**
 * T8.4 (ADR-0025): the reply field of a session survives navigation,
 * reload, an app update and a second device. A draft only ever fills the
 * field — sending stays a deliberate tap.
 *
 * Local copy (this device, offline too) + shared copy on the hub with a
 * revision. A stale save comes back as a conflict; the person chooses.
 */

interface LocalDraft {
  text: string;
  attachmentIds: string[];
  /** Hub revision this text is based on. */
  revision: number;
  /** Typed here, not yet on the hub. */
  dirty: boolean;
}

export function draftKey(hostKey: string, sessionId: string): string {
  return `uacc.draft.${hostKey}.${sessionId}`;
}

function readLocal(key: string): LocalDraft | null {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? "null") as LocalDraft | null;
    return v && typeof v.text === "string" ? v : null;
  } catch {
    return null;
  }
}

function writeLocal(key: string, d: LocalDraft): void {
  if (!d.text && d.attachmentIds.length === 0 && !d.dirty) localStorage.removeItem(key);
  else localStorage.setItem(key, JSON.stringify(d));
}

/** What to do when the page opens: pure, so it is testable. */
export function reconcile(local: LocalDraft | null, server: SessionDraft | null): { text: string; attachmentIds: string[]; revision: number; push: boolean; conflict: SessionDraft | null } {
  if (!server) return { text: local?.text ?? "", attachmentIds: local?.attachmentIds ?? [], revision: local?.revision ?? 0, push: false, conflict: null };
  if (!local || !local.dirty) return { text: server.text, attachmentIds: server.attachmentIds, revision: server.revision, push: false, conflict: null };
  if (server.revision === local.revision || server.text === local.text) return { text: local.text, attachmentIds: local.attachmentIds, revision: server.revision, push: server.text !== local.text, conflict: null };
  // Both changed: keep mine in the field, show theirs.
  return { text: local.text, attachmentIds: local.attachmentIds, revision: local.revision, push: false, conflict: server };
}

const SAVE_DELAY_MS = 700;
const POLL_MS = 4000;

export function useDraft(opts: {
  api: HubApi;
  hostKey: string;
  sessionId: string;
  text: string;
  setText: (t: string) => void;
  attachments: AttachmentRecord[];
  setAttachments: (a: AttachmentRecord[]) => void;
}): { conflict: SessionDraft | null; takeTheirs: () => void; keepMine: () => void; clear: () => Promise<void>; state: "saved" | "local" | "saving" | "idle" } {
  const { api, sessionId } = opts;
  const key = draftKey(opts.hostKey, sessionId);
  const revision = useRef(0);
  const synced = useRef<string>("");
  const loaded = useRef(false);
  const [conflict, setConflict] = useState<SessionDraft | null>(null);
  const [state, setState] = useState<"saved" | "local" | "saving" | "idle">("idle");

  const restoreAttachments = async (ids: string[]) => {
    if (ids.length === 0) return opts.setAttachments([]);
    const records = await Promise.all(ids.map((id) => api.attachment(id).catch(() => null)));
    opts.setAttachments(records.filter((r): r is AttachmentRecord => r !== null));
  };

  // Open: local copy at once (offline, reload), then the hub's.
  useEffect(() => {
    const local = readLocal(key);
    if (local?.text) opts.setText(local.text);
    if (local) revision.current = local.revision;
    let alive = true;
    api
      .draft(sessionId)
      .then((server) => {
        if (!alive) return;
        const r = reconcile(local, server);
        revision.current = r.revision;
        synced.current = r.push ? "" : server.text;
        opts.setText(r.text);
        void restoreAttachments(r.attachmentIds);
        setConflict(r.conflict);
        loaded.current = true;
        if (r.push) void push(r.text, r.attachmentIds);
        else setState(r.text ? "saved" : "idle");
      })
      .catch(() => {
        loaded.current = true;
        if (local) void restoreAttachments(local.attachmentIds);
        setState(local?.dirty ? "local" : "idle");
      });
    return () => {
      alive = false;
    };
  }, [key]);

  const push = async (text: string, attachmentIds: string[]) => {
    setState("saving");
    try {
      const res = await api.saveDraft(sessionId, text, attachmentIds, revision.current);
      if (res.ok) {
        revision.current = res.draft.revision;
        synced.current = res.draft.text;
        writeLocal(key, { text, attachmentIds, revision: res.draft.revision, dirty: false });
        setState(text ? "saved" : "idle");
      } else {
        setConflict(res.current);
        setState("local");
      }
    } catch {
      setState("local"); // offline: stays here, pushed on the next edit or reload
    }
  };

  // Every edit: locally at once, to the hub after a short pause.
  const ids = opts.attachments.map((a) => a.id).join(",");
  useEffect(() => {
    if (!loaded.current) return;
    const attachmentIds = opts.attachments.map((a) => a.id);
    if (opts.text === synced.current && attachmentIds.length === 0 && state !== "local") {
      // Back to what the hub has: the local copy must say so too, or an
      // older unsent text comes back after a reload.
      writeLocal(key, { text: opts.text, attachmentIds, revision: revision.current, dirty: false });
      return;
    }
    writeLocal(key, { text: opts.text, attachmentIds, revision: revision.current, dirty: true });
    if (conflict) return;
    const t = setTimeout(() => void push(opts.text, attachmentIds), SAVE_DELAY_MS);
    return () => clearTimeout(t);
  }, [opts.text, ids, conflict]);

  // Another device typed while this one only watched: follow it.
  useEffect(() => {
    const t = setInterval(() => {
      if (!loaded.current || conflict || opts.text !== synced.current) return;
      api
        .draft(sessionId)
        .then((server) => {
          if (server.revision > revision.current && opts.text === synced.current) {
            revision.current = server.revision;
            synced.current = server.text;
            opts.setText(server.text);
            void restoreAttachments(server.attachmentIds);
            writeLocal(key, { text: server.text, attachmentIds: server.attachmentIds, revision: server.revision, dirty: false });
          }
        })
        .catch(() => undefined);
    }, POLL_MS);
    return () => clearInterval(t);
  }, [opts.text, conflict]);

  return {
    conflict,
    state,
    takeTheirs: () => {
      if (!conflict) return;
      revision.current = conflict.revision;
      synced.current = conflict.text;
      opts.setText(conflict.text);
      void restoreAttachments(conflict.attachmentIds);
      writeLocal(key, { text: conflict.text, attachmentIds: conflict.attachmentIds, revision: conflict.revision, dirty: false });
      setConflict(null);
    },
    keepMine: () => {
      if (!conflict) return;
      revision.current = conflict.revision;
      setConflict(null);
      void push(opts.text, opts.attachments.map((a) => a.id));
    },
    /** After a successful send: empty here and on the hub. */
    clear: async () => {
      synced.current = "";
      localStorage.removeItem(key);
      await api
        .saveDraft(sessionId, "", [], revision.current)
        .then((res) => {
          if (res.ok) revision.current = res.draft.revision;
        })
        .catch(() => undefined);
      setState("idle");
    },
  };
}
