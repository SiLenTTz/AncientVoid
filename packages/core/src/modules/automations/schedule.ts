import { cronFieldValid, AUTOMATION_LIMITS } from "@ancientvoid/contracts";
import type { AutomationSchedule } from "@ancientvoid/contracts";

/**
 * EPIC-P41 T41.2 (ADR-0064): Occurrence-Berechnung für den begrenzten Cron.
 * Pure Funktion ohne Uhr — der Scheduler (T41.3) liefert `from`; Tests halten
 * die DST-Regeln deterministisch: ungültige Lokalzeit wird übersprungen,
 * doppelte Lokalzeit feuert genau einmal (die frühere echte Zeit).
 */

/** Vixie-Cron-Semantik: sind dom UND dow eingeschränkt, gilt ODER; sonst UND. */
export type CronFields = { minute: number[]; hour: number[]; dom: number[]; month: number[]; dow: number[] };

const BOUNDS = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 6]] as const;

/** Ein Feld des begrenzten Subset in die Menge seiner Minuten/Stunden/... expandieren. */
export function expandCronField(field: string, min: number, max: number): number[] | null {
  if (!cronFieldValid(field, min, max)) return null;
  const out = new Set<number>();
  for (const part of field.split(",")) {
    const [base, stepStr] = part.split("/");
    const step = stepStr === undefined ? 1 : Number(stepStr);
    if (!Number.isInteger(step) || step < 1) return null;
    let lo = min;
    let hi = max;
    if (base !== "*") {
      const nums = base!.split("-").map(Number);
      if (nums.some((n) => !Number.isInteger(n) || n < min || n > max)) return null;
      if (nums.length === 1) {
        if (stepStr !== undefined) {
          lo = nums[0]!;
          hi = max;
        } else {
          out.add(nums[0]!);
          continue;
        }
      } else {
        if (nums[0]! > nums[1]!) return null;
        lo = nums[0]!;
        hi = nums[1]!;
      }
    }
    for (let n = lo; n <= hi; n += step) out.add(n);
  }
  return out.size > 0 ? [...out].sort((a, b) => a - b) : null;
}

function splitCron(cron: string): [string, string, string, string, string] | null {
  const f = cron.trim().split(/\s+/);
  return f.length === 5 ? [f[0]!, f[1]!, f[2]!, f[3]!, f[4]!] : null;
}

/** Preset → Cron-Raster (So=0 wie Cron); `weekly` ohne Auswahl = alle Tage, `hourly` = Minute 0. */
function presetToFieldsParts(schedule: { preset: string; localTime?: string | undefined; weekdays?: number[] | undefined }): [string, string, string, string, string] {
  const [h, m] = schedule.localTime ? schedule.localTime.split(":").map(Number) as [number, number] : [0, 0];
  switch (schedule.preset) {
    case "hourly":
      return ["0", "*", "*", "*", "*"];
    case "daily":
      return [String(m), String(h), "*", "*", "*"];
    case "weekly":
      return [String(m), String(h), "*", "*", (schedule.weekdays?.length ? schedule.weekdays : [0, 1, 2, 3, 4, 5, 6]).join(",")];
    case "weekday":
      return [String(m), String(h), "*", "*", "1-5"];
    default:
      throw new Error(`unbekanntes Preset „${schedule.preset}“`);
  }
}

/** Presets und Cron-Felder in ein einheitliches Feld-Raster; null bei unzulässigem Feld. */
export function scheduleToFields(schedule: AutomationSchedule): CronFields | null {
  const source = schedule.kind === "cron" ? splitCron(schedule.cron) : presetToFieldsParts(schedule);
  if (!source) return null;
  const parts = BOUNDS.map(([min, max], i) => expandCronField(source[i]!, min, max));
  if (parts.some((p) => p === null)) return null;
  const [minute, hour, dom, month, dow] = parts as [number[], number[], number[], number[], number[]];
  return { minute, hour, dom, month, dow };
}

const FORMATTERS = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string): Intl.DateTimeFormat {
  let f = FORMATTERS.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", calendar: "gregory", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    FORMATTERS.set(tz, f);
  }
  return f;
}

type WallParts = { y: number; mo: number; d: number; h: number; mi: number };

/** Die lokale Wandzeit eines UTC-Moments in der Zone (kanonische Richtung). */
function localParts(epochMs: number, tz: string): WallParts {
  const parts = formatter(tz).formatToParts(new Date(epochMs));
  const val = (t: string): number => Number(parts.find((p) => p.type === t)!.value);
  return { y: val("year"), mo: val("month"), d: val("day"), h: val("hour") % 24, mi: val("minute") };
}

/** Wandzeit-Pseudouktz (Date.UTC-Ergebnis) in dieselbe Darstellungsform gebracht. */
function pseudoParts(wallMs: number): WallParts {
  const d = new Date(wallMs);
  return { y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes() };
}

function sameWall(a: WallParts, b: WallParts): boolean {
  return a.y === b.y && a.mo === b.mo && a.d === b.d && a.h === b.h && a.mi === b.mi;
}

function offsetMinutesAt(epochMs: number, tz: string): number {
  const p = localParts(epochMs, tz);
  return Math.round((Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi) - epochMs) / 60_000);
}

/**
 * Alle UTC-Momente, deren Lokalzeit exakt dieser Wandzeit entspricht: keiner (DST-Lücke),
 * einer (normal) oder zwei (Herbst-Falle — der Aufrufer nimmt den ersten, ADR-0064).
 */
export function wallToUtcInstants(wallMs: number, tz: string): number[] {
  const expected = pseudoParts(wallMs);
  const found = new Set<number>();
  for (const probe of [wallMs, wallMs - 26 * 3_600_000, wallMs + 26 * 3_600_000]) {
    const instant = wallMs - offsetMinutesAt(probe, tz) * 60_000;
    if (sameWall(localParts(instant, tz), expected)) found.add(instant);
  }
  return [...found].sort((a, b) => a - b);
}

function offsetSuffix(epochMs: number, tz: string): string {
  const min = offsetMinutesAt(epochMs, tz);
  const sign = min < 0 ? "-" : "+";
  const abs = Math.abs(min);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Die nächsten `count` Termine nach `fromUtc` (UTC-ISO, exklusiv), Scan bis +8 Jahre (inkl. achtjähriger Jahrhundert-Schaltlücke).
 * Ungültige Lokalzeit (Frühjahrswechsel) entfällt, doppelte Lokalzeit (Herbst) feuert einmal.
 */
export function nextOccurrences(schedule: AutomationSchedule, fromUtcIso: string, count: number): { utc: string; local: string }[] {
  if (!Number.isInteger(count) || count < 1 || count > AUTOMATION_LIMITS.preview) return [];
  const fields = scheduleToFields(schedule);
  if (!fields) return [];
  const tz = schedule.timezone;
  const fromMs = Date.parse(fromUtcIso);
  if (!Number.isFinite(fromMs)) return [];
  const out: number[] = [];
  const start = localParts(fromMs, tz);
  let dayMs = Date.UTC(start.y, start.mo - 1, start.d);
  for (let scanned = 0; scanned <= AUTOMATION_LIMITS.calendarDays && out.length < count; scanned++, dayMs += 86_400_000) {
    const dayDate = new Date(dayMs);
    const y = dayDate.getUTCFullYear();
    const mo = dayDate.getUTCMonth() + 1;
    const d = dayDate.getUTCDate();
    const dow = dayDate.getUTCDay();
    const domRestricted = fields.dom.length < 31;
    const dowRestricted = fields.dow.length < 7;
    const domOk = !domRestricted || fields.dom.includes(d);
    const dowOk = !dowRestricted || fields.dow.includes(dow);
    const dayOk = domRestricted && dowRestricted ? domOk || dowOk : domOk && dowOk;
    if (!fields.month.includes(mo) || !dayOk) continue;
    for (const h of fields.hour) {
      for (const m of fields.minute) {
        if (scanned === 0 && h * 60 + m < start.h * 60 + start.mi) continue;
        if (out.length >= count) break;
        const wallMs = Date.UTC(y, mo - 1, d, h, m);
        const instants = wallToUtcInstants(wallMs, tz);
        if (instants.length === 0) continue; // ungültige Lokalzeit: Überspringen (ADR-0064)
        const instant = instants[0]!; // doppelte Lokalzeit: genau einmal, die frühere
        if (instant > fromMs && !out.includes(instant)) out.push(instant);
      }
    }
  }
  return out
    .sort((a, b) => a - b)
    .slice(0, count)
    .map((ms) => {
      const p = localParts(ms, tz);
      return { utc: new Date(ms).toISOString(), local: `${p.y}-${pad(p.mo)}-${pad(p.d)}T${pad(p.h)}:${pad(p.mi)}${offsetSuffix(ms, tz)}` };
    });
}


/** Letzter kanonischer Termin <= Grenze; gleicher DST-/Cron-Vertrag wie die Vorschau. */
export function previousOccurrence(schedule: AutomationSchedule, untilUtcIso: string): string | null {
  const fields = scheduleToFields(schedule);
  const until = Date.parse(untilUtcIso);
  if (!fields || !Number.isFinite(until)) return null;
  const tz = schedule.timezone;
  const start = localParts(until, tz);
  let dayMs = Date.UTC(start.y, start.mo - 1, start.d);
  const repeated = offsetMinutesAt(until - 26 * 3_600_000, tz) > offsetMinutesAt(until, tz);
  for (let day = 0; day <= AUTOMATION_LIMITS.calendarDays; day++, dayMs -= 86_400_000) {
    const date = new Date(dayMs);
    const d = date.getUTCDate();
    const domRestricted = fields.dom.length < 31;
    const dowRestricted = fields.dow.length < 7;
    const dom = !domRestricted || fields.dom.includes(d);
    const dow = !dowRestricted || fields.dow.includes(date.getUTCDay());
    if (!fields.month.includes(date.getUTCMonth() + 1) || !(domRestricted && dowRestricted ? dom || dow : dom && dow)) continue;
    for (const h of [...fields.hour].reverse()) for (const m of [...fields.minute].reverse()) {
      if (day === 0 && !repeated && h * 60 + m > start.h * 60 + start.mi) continue;
      const instant = wallToUtcInstants(dayMs + (h * 60 + m) * 60_000, tz)[0];
      if (instant !== undefined && instant <= until) return new Date(instant).toISOString();
    }
  }
  return null;
}
