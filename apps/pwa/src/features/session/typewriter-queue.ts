import { useEffect, useRef, useState } from "preact/hooks";
import { isLiveTs, queueStep, TW_TICK_MS, typewriterActive } from "../../shared/typewriter.ts";
import { visibleEventText } from "./event-text.ts";
import type { ChatItem } from "./turns.ts";

/** Ein Stück, das der Typwriter zeigen könnte (Chat-Output oder Thinking, in Anzeigereihenfolge). */
export type TypewriterTarget = { key: string; ts: string; len: number };

/**
 * EPIC-P58 T58.2: die Tipp-Queue des Chats. Getippt wird nur neuer Live-Zuwachs — was beim
 * Mount schon da war (History/Backfill), rendert sofort (AC-P58-2); als live gilt ein Ereignis,
 * dessen Zeitstempel frischer ist als die Gnadenfrist (shared/typewriter.ts). Der Takt schiebt
 * das älteste unfertige Stück weiter, der Rest wartet; wird es zu viel, rastet alles ein
 * (Aufhol- und Sofort-Fallback, Epic §3.2). Reduce Motion und der Haupt-Schalter gewinnen immer.
 * K7: der Tipp-Zustand ist flüchtig — nach Demounten bleibt nichts.
 */
export function useTypewriterQueue(targets: TypewriterTarget[]): (key: string) => number | null {
  const live = useRef(new Map<string, boolean>());
  const targetsRef = useRef(targets);
  targetsRef.current = targets;
  const [shown, setShown] = useState<Record<string, number>>({});

  useEffect(() => {
    const timer = setInterval(() => {
      if (!typewriterActive()) return;
      setShown((prev) => {
        const pend = targetsRef.current.filter((t) => live.current.get(t.key) === true && (prev[t.key] ?? 0) < t.len);
        if (pend.length === 0) return prev;
        const next = { ...prev };
        let changed = false;
        for (const [i, t] of pend.entries()) {
          const value = queueStep(next[t.key] ?? 0, t.len, i, pend.length);
          if (value !== (next[t.key] ?? 0)) {
            next[t.key] = value;
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, TW_TICK_MS);
    return () => clearInterval(timer);
  }, []);

  return (key: string) => {
    const target = targetsRef.current.find((t) => t.key === key);
    if (!target) return null;
    let isLive = live.current.get(key);
    if (isLive === undefined) {
      isLive = isLiveTs(target.ts);
      live.current.set(key, isLive);
    }
    if (!isLive || !typewriterActive()) return null;
    return shown[key] ?? 0;
  };
}

/** Der Text, den ein Typwriter-Ziel zeigt — Slice des sichtbaren Textes, null heißt voller Text. */
export function typedText(fullText: string, shownChars: number | null | undefined): string {
  if (shownChars === null || shownChars === undefined || shownChars >= fullText.length) return fullText;
  return fullText.slice(0, shownChars);
}

/** Hilfsfunktion für ChatTurns: die Typwriter-Ziele aus den Chat-Elementen (nur Agententext und Reasoning). */
export function typewriterTargets(items: ChatItem[]): TypewriterTarget[] {
  const out: TypewriterTarget[] = [];
  for (const item of items) {
    if (item.kind === "event") {
      if (item.event.type !== "assistant" && item.event.type !== "thinking") continue;
      const len = visibleEventText(item.event).length;
      if (len > 0) out.push({ key: String(item.event.seq), ts: item.event.ts, len });
    } else if (item.kind === "work") {
      // Notizen im Arbeitsblock zeigen die Summary — die wird getippt, nicht der Payload.
      for (const entry of item.entries) {
        if (entry.kind !== "note") continue;
        if (entry.event.type !== "assistant" && entry.event.type !== "thinking") continue;
        if (entry.event.summary.length > 0) out.push({ key: String(entry.event.seq), ts: entry.event.ts, len: entry.event.summary.length });
      }
    }
  }
  return out;
}
