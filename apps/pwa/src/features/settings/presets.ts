import { parseWindowMessage, type WindowTarget } from "../windows/protocol.ts";
import { accentWarnings, contrastRatio, DEFAULT_APPEARANCE, FONTS, getAppearance, normalizeHex, setAppearance, type Appearance } from "../../app/appearance.ts";
import { applyTheme, getTheme, type Theme } from "../../app/theme.ts";
import { LAYOUTS, type Layout } from "../workspace/tiles.ts";

const PRESET_KEY = "ancientvoid.presentation.v1";
export const PRESET_EVENT = "ancientvoid:presentation";
export interface WindowGeometry { left: number; top: number; width: number; height: number }
interface WindowPlacement { target: WindowTarget; geometry: WindowGeometry }
export interface DevicePreset {
  version: 1;
  windows?: WindowPlacement[];
  theme: Theme;
  appearance: Appearance;
  codeScale: number;
  density: "comfortable" | "compact";
  chatWidth: "full" | "readable";
  surface: string | null;
  border: number;
  radius: number;
  background: string | null;
  layout: { kind: Layout; col: number; row: number; col2: number; window: WindowGeometry };
}
export function defaultPreset(): DevicePreset {
  return { version: 1, theme: "dark", appearance: structuredClone(DEFAULT_APPEARANCE), codeScale: 1, density: "comfortable", chatWidth: "full", surface: null, border: 1, radius: 7, background: null, layout: { kind: "1", col: 0.5, row: 0.5, col2: 2 / 3, window: { left: 0, top: 0, width: 960, height: 720 } } };
}
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(k => !keys.includes(k))) throw new Error("Unbekanntes oder unzulässiges Preset-Feld.");
  return value as Record<string, unknown>;
}
function number(value: unknown, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) throw new Error(`Zahl muss zwischen ${min} und ${max} liegen.`);
  return value;
}
function choice<T extends string>(value: unknown, choices: readonly T[]): T {
  if (!choices.includes(value as T)) throw new Error("Unbekannter Preset-Wert.");
  return value as T;
}
function color(v: unknown): string | null {
  if (v === null) return null;
  if (typeof v !== "string" || !/^#[a-f\d]{6}$/i.test(v)) throw new Error("Nur lokale Farbwerte im Format #rrggbb sind erlaubt.");
  return normalizeHex(v);
}
export function parsePreset(raw: string): DevicePreset {
  if (raw.length > 800_000) throw new Error("Preset zu groß (maximal 800 KB).");
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error("Ungültiges Preset-JSON."); }
  const legacy = object(value, ["version", "windows", "theme", "appearance", "codeScale", "density", "chatWidth", "surface", "border", "radius", "background", "layout", "accent", "fontUi", "fontCode", "fontScale"]);
  // Migration des bisherigen, unversionierten Geräteformats. Unbekannte Felder bleiben verboten.
  const migrated = legacy.version === undefined && "fontUi" in legacy ? { ...defaultPreset(), appearance: object(legacy, ["accent", "fontUi", "fontCode", "fontScale"]) } : legacy;
  const d = object(migrated, ["version", "windows", "theme", "appearance", "codeScale", "density", "chatWidth", "surface", "border", "radius", "background", "layout"]);
  if (d.version !== 1) throw new Error("Nicht unterstützte Preset-Version.");
  const theme = choice(d.theme, ["dark", "light"] as const);
  const a = object(d.appearance, ["accent", "fontUi", "fontCode", "fontScale"]);
  const accent = object(a.accent, ["dark", "light"]);
  const appearance: Appearance = { accent: { dark: color(accent.dark), light: color(accent.light) }, fontUi: choice(a.fontUi, FONTS.map(f => f.id)), fontCode: choice(a.fontCode, FONTS.filter(f => f.mono).map(f => f.id)), fontScale: number(a.fontScale, 0.85, 1.3) };
  for (const t of ["dark", "light"] as const) if (appearance.accent[t] && accentWarnings(appearance.accent[t], t).length) throw new Error("Akzent: unzureichender Kontrast oder Verwechslung mit Statusfarben.");
  const surface = color(d.surface);
  const fg = theme === "dark" ? "#7b8391" : "#666d7d";
  if (surface && contrastRatio(fg, surface) < 4.5) throw new Error("Oberfläche: Textkontrast unter 4,5:1.");
  // Rasterdaten ausschließlich lokal; SVG und URLs können aktive Inhalte/Netzwerk laden.
  const background = d.background;
  if (background !== null && (typeof background !== "string" || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(background))) throw new Error("Nur lokale PNG-, JPEG- oder WebP-Bilder erlaubt.");
  if (typeof background === "string") {
    let bytes: string;
    try { bytes = atob(background.split(",")[1]!); } catch { throw new Error("Ungültige Bilddaten."); }
    const valid = background.startsWith("data:image/png;") ? bytes.startsWith("\x89PNG\r\n\x1a\n") : background.startsWith("data:image/jpeg;") ? bytes.startsWith("\xff\xd8\xff") : bytes.startsWith("RIFF") && bytes.slice(8, 12) === "WEBP";
    if (!valid || bytes.length > 500_000) throw new Error("Ungültiges Rasterbild oder Bild größer als 500 KB.");
  }
  const l = object(d.layout, ["kind", "col", "row", "col2", "window"]);
  const w = object(l.window, ["left", "top", "width", "height"]);
  const col = number(l.col, 0.2, 0.8), col2 = number(l.col2, 0.2, 0.9);
  if (col2 < col + 0.1 - 0.0001) throw new Error("Spaltengrenzen überlappen.");
  let windows: WindowPlacement[] | undefined;
  if (d.windows !== undefined) {
    if (!Array.isArray(d.windows) || d.windows.length > 12) throw new Error("Maximal zwölf Fenster pro Layout.");
    windows = d.windows.map(raw => {
      const entry = object(raw, ["target", "geometry"]);
      const target = object(entry.target, ["kind", "sessionId", "hostId", "page", "path"]);
      const msg = parseWindowMessage({ type: "hello", id: "preset", target });
      if (!msg || msg.type !== "hello") throw new Error("Ungültiges Fensterziel.");
      const g = object(entry.geometry, ["left", "top", "width", "height"]);
      return { target: msg.target, geometry: { left: number(g.left, -100000, 100000), top: number(g.top, -100000, 100000), width: number(g.width, 280, 10000), height: number(g.height, 280, 10000) } };
    });
  }
  return { version: 1, ...(windows ? { windows } : {}), theme, appearance, codeScale: number(d.codeScale, 0.85, 1.3), density: choice(d.density, ["comfortable", "compact"] as const), chatWidth: choice(d.chatWidth, ["full", "readable"] as const), surface, border: number(d.border, 1, 3), radius: number(d.radius, 0, 20), background: background as string | null, layout: { kind: choice(l.kind, LAYOUTS), col, col2, row: number(l.row, 0.2, 0.8), window: { left: number(w.left, -100000, 100000), top: number(w.top, -100000, 100000), width: number(w.width, 280, 10000), height: number(w.height, 280, 10000) } } };
}
export function clampWindow(w: WindowGeometry, screen: { width: number; height: number }): WindowGeometry {
  const width = Math.min(w.width, screen.width), height = Math.min(w.height, screen.height);
  return { width, height, left: Math.max(0, Math.min(w.left, screen.width - width)), top: Math.max(0, Math.min(w.top, screen.height - height)) };
}
export function surfaceForTheme(surface: string | null, theme: Theme): string | null {
  const fg = theme === "dark" ? "#7b8391" : "#666d7d";
  return surface && contrastRatio(fg, surface) >= 4.5 ? surface : null;
}
export function getPreset(): DevicePreset {
  const raw = localStorage.getItem(PRESET_KEY);
  if (!raw) return { ...defaultPreset(), theme: getTheme(), appearance: getAppearance() };
  try { const stored = parsePreset(raw); return { ...stored, theme: getTheme(), appearance: getAppearance(), surface: surfaceForTheme(stored.surface, getTheme()) }; }
  catch { return { ...defaultPreset(), theme: getTheme(), appearance: getAppearance() }; }
}
function applyPresentation(p: DevicePreset): void {
  const root = document.documentElement;
  root.dataset.density = p.density;
  root.dataset.chatWidth = p.chatWidth;
  root.style.setProperty("--code-scale", String(p.codeScale));
  root.style.setProperty("--radius", `${p.radius}px`);
  root.style.setProperty("--preset-border", `${p.border}px`);
  if (p.surface) root.style.setProperty("--bg-elev", p.surface); else root.style.removeProperty("--bg-elev");
  root.style.setProperty("--device-background", p.background ? `url("${p.background}")` : "none");
}
export function setPreset(p: DevicePreset): void {
  const safe = parsePreset(JSON.stringify(p));
  localStorage.setItem(PRESET_KEY, JSON.stringify(safe));
  applyTheme(safe.theme);
  setAppearance(safe.appearance);
  applyPresentation(safe);
  window.dispatchEvent(new CustomEvent(PRESET_EVENT));
}
export function initPresentation(): void {
  applyPresentation(getPreset());
  window.addEventListener("ancientvoid:theme", () => applyPresentation(getPreset()));
  window.addEventListener("storage", e => { if (e.key === PRESET_KEY || e.key === "ancientvoid.theme" || e.key === null) applyPresentation(getPreset()); });
}
