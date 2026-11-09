import { chmod, copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname } from "node:path";
import type { CustomModel, CustomModelInput, ModelOption, PiProviderInput } from "@ancientvoid/contracts";

type Settings = { get(key: string): string | null; set(key: string, value: string | null): void };

const KEY = "models.custom";

/**
 * ADR-0060: Hub-Register eigener Modelle. Liegt in der `config`-Tabelle (SQLite), ist also wie jede
 * Einstellung Teil von Backup und Recovery (K7); der Katalog selbst bleibt Antwort des Adapters,
 * das Register ergänzt ihn nur (ADR-0054 §6: keine zweite Katalog-Wahrheit).
 */
export class CustomModelStore {
  private readonly settings: Settings;

  constructor(settings: Settings) {
    this.settings = settings;
  }

  list(): CustomModel[] {
    try {
      const raw = JSON.parse(this.settings.get(KEY) ?? "[]") as CustomModel[];
      return Array.isArray(raw) ? raw : [];
    } catch {
      return [];
    }
  }

  /** Same id → replaced (edit), never duplicated. */
  add(input: CustomModelInput): CustomModel {
    const entry: CustomModel = { id: input.id, ...(input.label ? { label: input.label } : {}), adapters: [...new Set(input.adapters)] };
    this.settings.set(KEY, JSON.stringify([...this.list().filter((m) => m.id !== entry.id), entry]));
    return entry;
  }

  remove(id: string): boolean {
    const all = this.list();
    const next = all.filter((m) => m.id !== id);
    if (next.length === all.length) return false;
    this.settings.set(KEY, next.length ? JSON.stringify(next) : null);
    return true;
  }

  /** The adapter's own catalog plus the register's entries for it; the adapter's entry wins on a clash. */
  merge(adapterId: string, catalog: ModelOption[] | null): { models: ModelOption[]; customIds: string[] } {
    const own = catalog ?? [];
    const known = new Set(own.map((m) => m.id));
    const extra = this.list().filter((m) => (m.adapters.length === 0 || m.adapters.includes(adapterId)) && !known.has(m.id));
    return {
      models: [...own, ...extra.map((m) => ({ id: m.id, ...(m.label ? { label: m.label } : {}) }))],
      customIds: extra.map((m) => m.id),
    };
  }
}

export type ProviderWriteResult = { ok: true; created: boolean; backup: string | null } | { ok: false; status: 409 | 422; detail: string };

/**
 * Trägt einen Provider in die models.json von pi ein (dokumentiertes Schema, pi docs/models.md; pi lädt
 * die Datei beim Öffnen von /model neu). Bestehende Provider bleiben unberührt: ein vorhandener Name
 * wird nur mit `replace` ersetzt. Vorher entsteht eine Sicherung, geschrieben wird atomar mit 0600 —
 * die Datei kann einen Schlüssel enthalten.
 */
export async function writePiProvider(file: string, input: PiProviderInput, opts: { replace?: boolean; now?: () => Date } = {}): Promise<ProviderWriteResult> {
  let doc: { providers?: Record<string, unknown>; [k: string]: unknown } = {};
  if (existsSync(file)) {
    try {
      doc = JSON.parse(await readFile(file, "utf8")) as typeof doc;
    } catch {
      return { ok: false, status: 422, detail: "models.json von pi ist kein gültiges JSON — der Hub schreibt nicht hinein." };
    }
    if (typeof doc !== "object" || doc === null || Array.isArray(doc)) return { ok: false, status: 422, detail: "models.json von pi hat ein unerwartetes Format." };
  } else {
    doc = { $schema: "https://pi.dev/schemas/models.schema.json" };
  }
  const providers = (doc.providers && typeof doc.providers === "object" ? doc.providers : {}) as Record<string, unknown>;
  const exists = Object.prototype.hasOwnProperty.call(providers, input.name);
  if (exists && !opts.replace) return { ok: false, status: 409, detail: `Provider „${input.name}“ gibt es in pi schon — zum Ersetzen ausdrücklich bestätigen.` };

  providers[input.name] = {
    baseUrl: input.baseUrl,
    api: input.api,
    ...(input.apiKey ? { apiKey: input.apiKey } : {}),
    models: input.models.map((m) => ({
      id: m.id,
      ...(m.name ? { name: m.name } : {}),
      ...(m.contextWindow ? { contextWindow: m.contextWindow } : {}),
      ...(m.maxTokens ? { maxTokens: m.maxTokens } : {}),
      ...(m.reasoning !== undefined ? { reasoning: m.reasoning } : {}),
    })),
  };
  doc.providers = providers;

  await mkdir(dirname(file), { recursive: true });
  let backup: string | null = null;
  if (existsSync(file)) {
    backup = `${file}.bak-${(opts.now?.() ?? new Date()).toISOString().replace(/[:.]/g, "-")}`;
    await copyFile(file, backup);
    await chmod(backup, 0o600);
  }
  const tmp = `${file}.tmp-${process.pid}`;
  await writeFile(tmp, `${JSON.stringify(doc, null, 2)}\n`, { mode: 0o600 });
  await rename(tmp, file);
  return { ok: true, created: !exists, backup };
}
