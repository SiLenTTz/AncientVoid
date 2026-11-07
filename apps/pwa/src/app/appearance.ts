import { getTheme, type Theme } from "./theme.ts";

/**
 * EPIC-P34 T34.4: Akzentfarbe, Schriftart und Schriftgröße als Gerätevorliebe, wie Theme und Zoom.
 * Rein, wo es geht (Parsen, Farbmathematik); angewendet wird vor dem ersten Paint (main.tsx).
 * Kaputte Werte im Speicher führen feldweise zum Standard — nie zu einer halb gesetzten Oberfläche.
 */
const KEY = "ancientvoid.appearance";
export const APPEARANCE_EVENT = "ancientvoid:appearance";

export type FontId = "jetbrains-mono" | "ibm-plex-mono" | "inter" | "atkinson" | "system-sans" | "system-mono";

export interface FontChoice {
  id: FontId;
  label: string;
  stack: string;
  /** Festbreite: nur diese Schriften sind für Code, Diff und Terminal erlaubt. */
  mono: boolean;
}

export const FONTS: readonly FontChoice[] = [
  { id: "jetbrains-mono", label: "JetBrains Mono", stack: '"JetBrains Mono", ui-monospace, "Fira Code", system-ui, monospace', mono: true },
  { id: "ibm-plex-mono", label: "IBM Plex Mono", stack: '"IBM Plex Mono", ui-monospace, monospace', mono: true },
  { id: "system-mono", label: "System Festbreite", stack: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace', mono: true },
  { id: "inter", label: "Inter", stack: '"Inter", system-ui, sans-serif', mono: false },
  { id: "atkinson", label: "Atkinson Hyperlegible", stack: '"Atkinson Hyperlegible", system-ui, sans-serif', mono: false },
  { id: "system-sans", label: "System Sans", stack: 'system-ui, -apple-system, "Segoe UI", sans-serif', mono: false },
];

export const FONT_SCALE_MIN = 0.85;
export const FONT_SCALE_MAX = 1.3;
export const FONT_SCALE_STEP = 0.05;

export interface Appearance {
  /** #rrggbb je Theme; null = Standard des Stylesheets. */
  accent: { dark: string | null; light: string | null };
  fontUi: FontId;
  fontCode: FontId;
  fontScale: number;
}

export const DEFAULT_ACCENT = { dark: "#ff9a3c", light: "#d9601a" } as const;

export const DEFAULT_APPEARANCE: Appearance = {
  accent: { dark: null, light: null },
  fontUi: "jetbrains-mono",
  fontCode: "jetbrains-mono",
  fontScale: 1,
};

// ---------- Farbmathematik ----------

export interface Rgb {
  r: number;
  g: number;
  b: number;
}
export interface Hsv {
  /** 0–360 */
  h: number;
  /** 0–100 */
  s: number;
  /** 0–100 */
  v: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function normalizeHex(input: string): string | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(input.trim());
  if (!m?.[1]) return null;
  const digits = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1];
  return `#${digits.toLowerCase()}`;
}

export function hexToRgb(hex: string): Rgb {
  const n = Number.parseInt((normalizeHex(hex) ?? "#000000").slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const part = (v: number) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, "0");
  return `#${part(r)}${part(g)}${part(b)}`;
}

export function hexToHsv(hex: string): Hsv {
  const { r, g, b } = hexToRgb(hex);
  const [rn, gn, bn] = [r / 255, g / 255, b / 255];
  const max = Math.max(rn, gn, bn);
  const d = max - Math.min(rn, gn, bn);
  let h = 0;
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : (d / max) * 100, v: max * 100 };
}

export function hsvToHex({ h, s, v }: Hsv): string {
  const hue = ((h % 360) + 360) % 360;
  const sat = clamp(s, 0, 100) / 100;
  const val = clamp(v, 0, 100) / 100;
  const c = val * sat;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = val - c;
  const sector = Math.floor(hue / 60);
  const [r, g, b] = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][sector] ?? [0, 0, 0];
  return rgbToHex({ r: ((r ?? 0) + m) * 255, g: ((g ?? 0) + m) * 255, b: ((b ?? 0) + m) * 255 });
}

function luminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG-Kontrastverhältnis zweier Farben (1–21). */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Reines Schwarz oder Weiß: Eines von beiden erreicht auf jeder Fläche mindestens 4,58:1. */
export function accentInk(accent: string): "#000000" | "#ffffff" {
  return contrastRatio("#000000", accent) >= contrastRatio("#ffffff", accent) ? "#000000" : "#ffffff";
}

const SURFACE: Record<Theme, string> = { dark: "#121316", light: "#ffffff" };
const STATUS: Record<Theme, { name: string; hex: string }[]> = {
  dark: [
    { name: "läuft", hex: "#4fe0ab" },
    { name: "wartet", hex: "#ffcf5c" },
    { name: "Fehler", hex: "#ff5c6a" },
  ],
  light: [
    { name: "läuft", hex: "#158c62" },
    { name: "wartet", hex: "#9a6a06" },
    { name: "Fehler", hex: "#c72d3d" },
  ],
};
const STATUS_NEAR = 40;

/** Hinweise statt Verbote: die Wahl bleibt beim Nutzer, die Folgen stehen daneben. */
export function accentWarnings(hex: string, theme: Theme): string[] {
  const out: string[] = [];
  if (contrastRatio(hex, SURFACE[theme]) < 3) out.push("Wenig Kontrast zum Hintergrund — Akzentflächen und Rahmen sind schlecht zu sehen.");
  const me = hexToRgb(hex);
  for (const s of STATUS[theme]) {
    const o = hexToRgb(s.hex);
    if (Math.hypot(me.r - o.r, me.g - o.g, me.b - o.b) < STATUS_NEAR) out.push(`Ähnelt der Statusfarbe „${s.name}“ — Akzent und Status lassen sich schwer unterscheiden.`);
  }
  return out;
}

// ---------- Zustand ----------

export function clampFontScale(value: number): number {
  if (!Number.isFinite(value)) return 1;
  const stepped = Math.round(value / FONT_SCALE_STEP) * FONT_SCALE_STEP;
  return Math.round(clamp(stepped, FONT_SCALE_MIN, FONT_SCALE_MAX) * 100) / 100;
}

const font = (id: FontId) => FONTS.find((f) => f.id === id);

function accentField(raw: unknown): string | null {
  return typeof raw === "string" ? normalizeHex(raw) : null;
}

export function parseAppearance(raw: string | null): Appearance {
  if (!raw) return DEFAULT_APPEARANCE;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return DEFAULT_APPEARANCE;
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return DEFAULT_APPEARANCE;
  const d = data as { accent?: { dark?: unknown; light?: unknown }; fontUi?: unknown; fontCode?: unknown; fontScale?: unknown };
  const ui = FONTS.find((f) => f.id === d.fontUi);
  const code = FONTS.find((f) => f.id === d.fontCode && f.mono);
  return {
    accent: { dark: accentField(d.accent?.dark), light: accentField(d.accent?.light) },
    fontUi: ui?.id ?? DEFAULT_APPEARANCE.fontUi,
    fontCode: code?.id ?? DEFAULT_APPEARANCE.fontCode,
    fontScale: typeof d.fontScale === "number" ? clampFontScale(d.fontScale) : 1,
  };
}

export function isDefaultAppearance(a: Appearance): boolean {
  return a.accent.dark === null && a.accent.light === null && a.fontUi === DEFAULT_APPEARANCE.fontUi && a.fontCode === DEFAULT_APPEARANCE.fontCode && a.fontScale === 1;
}

export function getAppearance(): Appearance {
  return parseAppearance(localStorage.getItem(KEY));
}

interface StyleTarget {
  style: { setProperty(name: string, value: string): void; removeProperty(name: string): unknown };
}

/** Schreibt nur Abweichungen vom Standard auf das Dokument; im Standard bleibt das Stylesheet zuständig. */
export function applyAppearance(a: Appearance, theme: Theme, root: StyleTarget = document.documentElement): void {
  const accent = a.accent[theme];
  if (accent) {
    root.style.setProperty("--accent", accent);
    root.style.setProperty("--accent-ink", accentInk(accent));
  } else {
    root.style.removeProperty("--accent");
    root.style.removeProperty("--accent-ink");
  }
  const set = (name: string, value: string | null) => (value === null ? root.style.removeProperty(name) : root.style.setProperty(name, value));
  set("--font-ui", a.fontUi === DEFAULT_APPEARANCE.fontUi ? null : (font(a.fontUi)?.stack ?? null));
  set("--font-code", a.fontCode === DEFAULT_APPEARANCE.fontCode ? null : (font(a.fontCode)?.stack ?? null));
  set("--font-scale", a.fontScale === 1 ? null : String(a.fontScale));
}

/** Live-Vorschau (Farbwähler, Schriftwahl): wirkt auf die Seite, ohne zu speichern. */
export function previewAppearance(a: Appearance): void {
  applyAppearance(a, getTheme());
}

export function setAppearance(next: Appearance): Appearance {
  if (isDefaultAppearance(next)) localStorage.removeItem(KEY);
  else localStorage.setItem(KEY, JSON.stringify(next));
  applyAppearance(next, getTheme());
  window.dispatchEvent(new CustomEvent(APPEARANCE_EVENT, { detail: next }));
  return next;
}

/**
 * Vor dem ersten Paint aufrufen. Hält mehrere Fenster (T34.10) und den Themewechsel synchron:
 * `storage` kommt aus anderen Fenstern, `ancientvoid:theme` aus diesem.
 */
export function initAppearance(): () => void {
  const reapply = () => applyAppearance(getAppearance(), getTheme());
  reapply();
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY || e.key === null) {
      reapply();
      window.dispatchEvent(new CustomEvent(APPEARANCE_EVENT, { detail: getAppearance() }));
    }
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener("ancientvoid:theme", reapply);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener("ancientvoid:theme", reapply);
  };
}
