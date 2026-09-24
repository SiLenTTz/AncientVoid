import type { AttachmentRecord, MediaStep } from "./api.ts";

/** EPIC-P10.5: the helpers of `@uacc/contracts` media, mirrored for the PWA. */
export const MEDIA_STEP_LABELS: Record<MediaStep, string> = {
  fetch: "Quelle holen",
  probe: "Prüfen",
  audio: "Transkript",
  frames: "Schlüsselbilder",
  vision: "Bilder lesen",
  merge: "Zeitleiste",
  summarize: "Zusammenfassung",
};
export const MEDIA_STEPS = Object.keys(MEDIA_STEP_LABELS) as MediaStep[];

/** 83_000 → "1:23", 3_723_000 → "1:02:03". */
export function formatTimestamp(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

/** Opens the source at a moment — YouTube and Vimeo know how; others: null. */
export function timestampLink(url: string | null, ms: number): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\.|^m\./, "");
    if (host === "youtube.com" || host === "youtu.be" || host === "music.youtube.com") {
      u.searchParams.set("t", `${Math.floor(ms / 1000)}s`);
      return u.toString();
    }
    if (host === "vimeo.com") return `${url.split("#")[0]}#t=${Math.floor(ms / 1000)}s`;
  } catch {
    return null;
  }
  return null;
}

/**
 * A result handed to a session: the new-session form or an open session
 * picks it up once (`target` = "new" or a session id).
 */
const PENDING = "uacc.pendingAttachments";

export function handOver(target: string, attachment: AttachmentRecord): void {
  sessionStorage.setItem(PENDING, JSON.stringify({ target, attachments: [attachment] }));
}

export function takeHandOver(target: string): AttachmentRecord[] {
  try {
    const raw = sessionStorage.getItem(PENDING);
    if (!raw) return [];
    const p = JSON.parse(raw) as { target: string; attachments: AttachmentRecord[] };
    if (p.target !== target) return [];
    sessionStorage.removeItem(PENDING);
    return p.attachments;
  } catch {
    return [];
  }
}
