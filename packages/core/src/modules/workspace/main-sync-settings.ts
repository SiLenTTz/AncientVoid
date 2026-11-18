import {
  MainSyncProjectOverride,
  MainSyncSettings,
  readMainSyncOverride,
  readMainSyncSettings,
  resolveMainSyncSettings,
  type MainSyncReadFallback,
} from "@ancientvoid/contracts";

/** Minimaler KV-Zugriff, wie ihn SettingsStore auf der config-Tabelle bereitstellt. */
export interface MainSyncKV {
  get(key: string): string | null;
  set(key: string, value: string | null): void;
}

const KEY_GLOBAL = "mainSync.global";
const KEY_PROJECTS = "mainSync.projects";

/**
 * EPIC-P67 / ADR-0088 T67.3: Speicher der Main-Sync-Einstellungen auf der
 * bestehenden `config`-Tabelle — ein JSON-Eintrag für die globalen Werte,
 * einer für die Projekt-Overrides (Map Projekt-Pfad → Patch). Kein eigener
 * Speicher, kein Migrationsschritt: fehlende Einträge gelten als Defaults
 * (K7 — Recovery ist das erneute Lesen).
 */
export class MainSyncSettingsService {
  private readonly kv: MainSyncKV;

  constructor(kv: MainSyncKV) {
    this.kv = kv;
  }

  /** Globale Einstellungen — `fallback` sagt, ob Defaults galten (invalid = Eintrag unlesbar, Regel 6). */
  global(): { value: MainSyncSettings; fallback: MainSyncReadFallback } {
    const raw = this.kv.get(KEY_GLOBAL);
    if (raw === null) return readMainSyncSettings(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      // korrupter Eintrag: Defaults gelten, aber als invalid benannt, nicht still
      return { ...readMainSyncSettings(null), fallback: "invalid" };
    }
    return readMainSyncSettings(parsed);
  }

  setGlobal(value: MainSyncSettings): void {
    MainSyncSettings.parse(value); // fail loud — Aufrufer (API) validiert vorher, hier ist die zweite Netzebene
    this.kv.set(KEY_GLOBAL, JSON.stringify(value));
  }

  /** Projekt-Overrides: Map Projekt-Pfad → Patch. */
  overrides(): { value: Record<string, MainSyncProjectOverride>; fallback: MainSyncReadFallback } {
    const raw = this.kv.get(KEY_PROJECTS);
    if (raw === null) return { value: {}, fallback: "missing" };
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      return { value: {}, fallback: "invalid" };
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return { value: {}, fallback: "invalid" };
    const out: Record<string, MainSyncProjectOverride> = {};
    let anyInvalid = false;
    for (const [path, override] of Object.entries(parsed as Record<string, unknown>)) {
      const read = readMainSyncOverride(override);
      if (read.fallback === "invalid") anyInvalid = true;
      if (Object.keys(read.value).length > 0) out[path] = read.value;
    }
    return { value: out, fallback: anyInvalid ? "invalid" : "none" };
  }

  setOverrides(map: Record<string, MainSyncProjectOverride>): void {
    const clean: Record<string, MainSyncProjectOverride> = {};
    for (const [path, override] of Object.entries(map)) {
      if (typeof path !== "string" || path === "") continue;
      const parsed = MainSyncProjectOverride.safeParse(override);
      if (!parsed.success) throw new Error(`ungültiger Override für ${path}`);
      if (Object.keys(parsed.data).length > 0) clean[path] = parsed.data;
    }
    this.kv.set(KEY_PROJECTS, JSON.stringify(clean));
  }

  overrideFor(projectPath: string): MainSyncProjectOverride {
    return this.overrides().value[projectPath] ?? {};
  }

  /** Effektive Einstellungen eines Projekts: Defaults ← global ← Projekt-Patch. */
  effective(projectPath: string): MainSyncSettings {
    return resolveMainSyncSettings(this.global().value, this.overrideFor(projectPath));
  }

  /** Resolver für den SessionManager (T67.2) — effektive Einstellungen je Projektpfad. */
  resolver(): (projectPath: string) => MainSyncSettings {
    return (projectPath: string) => this.effective(projectPath);
  }

}
