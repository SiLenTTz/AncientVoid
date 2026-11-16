/**
 * EPIC-P58: Typwriter-Effekt — Kern (Speicher, Gate, Tempo, Queue). Der Hook dazu lebt in
 * `features/session/typewriter-queue.ts`; dieses Modul ist bewusst DOM-frei, damit Tempo und
 * Gate testbar sind (T58.2). K5/K7 unverändert: reine clientseitige Darstellung, der Schalter
 * ist geräte-lokaler Bequemlichkeitszustand wie beim Rest der Appearance-Gruppe — kein
 * Session-State, kein Contract, kein ADR (Epic §2).
 */
import { motionAllowed } from "./motion.ts";

const TW_KEY = "ancientvoid.typewriter";

/** Takt des Tippens. Bewusst ein Interval, kein requestAnimationFrame: bei 25 Schritten/s
 * tippt es lesbar; gerätelastige Frames muss der Effekt nicht blockieren. */
export const TW_TICK_MS = 40;
/** Grundtempo: Zeichen pro Takt (~50 Zeichen/s — menschenartig, ohne@endlos zu brauchen). */
const TW_BASE_STEP = 2;
/** Aufholen (Epic §3.2): großer Rückstand wird beschleunigt dargestellt, Rest rastet ein. */
const TW_CATCHUP_DIVISOR = 6;
/** Tempo-Grenze im K2-Bereich (Epic §3.2): ab diesem Rückstand wird sofort gerendert. */
export const TW_IMMEDIATE_LAG = 300;
/** Queue-Grenze (T58.2): ab dieser Zahl wartender Stücke tippt die Queue nicht mehr, alles rastet ein. */
const TW_QUEUE_INSTANT = 8;
/** „Neuer Live-Zuwachs“ (Epic §3.2): ein Ereignis gilt als live, wenn sein Zeitstempel frischer ist. */
const TW_LIVE_GRACE_MS = 3_000;

export function typewriterOn(): boolean {
  // Standard: an (Epic §3.3). Ausdrücklich gespeichert wird in beide Richtungen —
  // der E2E-Fixture setzt den Startwert für Tests, die den Schalter nicht testen.
  return localStorage.getItem(TW_KEY) !== "0";
}

export function setTypewriterOn(on: boolean): void {
  localStorage.setItem(TW_KEY, on ? "1" : "0");
}

/** Reduce Motion und der Haupt-Bewegungsschalter gewinnen immer (Epic §3.2/§3.3, Premortem 3). */
export function typewriterActive(): boolean {
  return typewriterOn() && motionAllowed();
}

/** AC-P58-2: History rendert sofort — nur Frisches (Zeitstempel innerhalb der Gnadenfrist) gilt als Live-Zuwachs. */
export function isLiveTs(ts: string, now = Date.now()): boolean {
  const t = Date.parse(ts);
  return Number.isFinite(t) && now - t <= TW_LIVE_GRACE_MS;
}

/** Ein Tipp-Schritt für ein Stück mit Ziel `target`, bei `shown` angefangen. */
export function typeStep(shown: number, target: number): number {
  const lag = target - shown;
  if (lag <= 0) return target;
  if (lag >= TW_IMMEDIATE_LAG) return target;
  return Math.min(target, shown + Math.max(TW_BASE_STEP, Math.ceil(lag / TW_CATCHUP_DIVISOR)));
}

/**
 * Ein Queue-Schritt: `pos` ist die Stellung unter den noch unfertigen Stücken eines Zugs
 * (darf nicht springen: eins nach dem anderen). Wird die Queue zu lang (30 Events/s, K2),
 * rastet alles sofort ein — „drop-on-slow zuerst, dann komplett ohne Animation“ (Epic §3.2).
 */
export function queueStep(shown: number, target: number, pos: number, length: number): number {
  if (length >= TW_QUEUE_INSTANT) return target;
  if (pos > 0) return shown;
  return typeStep(shown, target);
}
