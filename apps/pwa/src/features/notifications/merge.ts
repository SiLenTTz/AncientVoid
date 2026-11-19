import type { HubNotification } from "../../shared/api.ts";

/** A notification with the host it came from (null = this hub). */
export type FleetNotification = HubNotification & { hostId: string | null; key: string; actionBusy?: boolean };

export interface NotificationPageResult<T> {
  /** Meldungen, die den Toast-/Sound-Pfad gehen (leer bei erster Ladung). */
  added: T[];
  /** Neuer Bestand der Glocke: neu dazu, dedupliziert, neueste zuerst, maximal 100. */
  next: T[];
}

/**
 * BUG-0222: eine Poll-Antwort in den Bestand einarbeiten. `known` ist der
 * zuletzt gesehene Cursor des Hosts — Meldungen mit `id <= known` sind bereits
 * angekommen (Spätantwort eines überlappenden Polls) und werden weder
 * gelistet noch angemeldet; der Bestand hält jeden `key` genau einmal.
 */
export function applyNotificationPage<T extends FleetNotification>(prev: readonly T[], page: readonly T[], known: number | null): NotificationPageResult<T> {
  const fresh = page.filter((n) => known === null || n.id > known);
  const added = known === null ? [] : fresh;
  const seen = new Set<string>();
  const merged: T[] = [];
  for (const n of [...fresh, ...prev]) {
    if (seen.has(n.key)) continue;
    seen.add(n.key);
    merged.push(n);
  }
  merged.sort((x, y) => (x.createdAt < y.createdAt ? 1 : -1));
  return { added, next: merged.slice(0, 100) };
}
