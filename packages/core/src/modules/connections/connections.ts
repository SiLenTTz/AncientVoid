import { createHash, randomUUID } from "node:crypto";
import {
  CONNECTION_PROBE_TIMEOUT_MS,
  type EndpointEntryInput,
  type EndpointEntryView,
  type EndpointProbe,
  type VoidWardenConnectionInput,
} from "@ancientvoid/contracts";

type Settings = { get(key: string): string | null; set(key: string, value: string | null): void };

const VOIDWARDEN_KEY = "connections.voidwarden";
const ENDPOINTS_KEY = "connections.endpoints";

/** Gespeicherte VoidWarden-Instanz — das Token selbst kennt nur die Token-Tabelle (als Hash). */
interface StoredVoidWarden {
  id: string;
  name: string;
  endpoint?: string;
  tokenLabel: string;
  createdAt: string;
}

/** Gespeicherter Endpoint — vom Schlüssel liegt hier nur der sha256-Hash, nie der Klartext. */
interface StoredEndpoint {
  id: string;
  name: string;
  kind: EndpointEntryView["kind"];
  baseUrl: string;
  apiKeyHash: string | null;
  models: string[];
  createdAt: string;
  probe: EndpointProbe | null;
}

/** sha256 eines Secrets — dieselbe Form wie hashToken (identity), lokal gehalten, weil Module einander nicht importieren (ADR-0020). */
function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

function readList<T>(settings: Settings, key: string): T[] {
  try {
    const raw = JSON.parse(settings.get(key) ?? "[]") as T[];
    return Array.isArray(raw) ? raw : [];
  } catch {
    // Kaputte Konfiguration darf nie still als [] gelten, ohne dass es auffällt:
    // fail loud beim Schreiben, lesend liefern wir [] und der Nutzer legt neu an.
    return [];
  }
}

/**
 * Registry der Verbindungen (Optionsbereich der PWA): VoidWarden-Instanzen und
 * Modell-/Tool-Endpoints. Persistiert in der `config`-Tabelle — damit Teil von
 * Backup und Recovery (K7) wie jedes CustomModel auch. Listen-Operationen
 * geben interne Records zurück; die HTTP-Schicht baut daraus die Views ohne
 * Secrets.
 */
export class ConnectionStore {
  private readonly settings: Settings;

  constructor(settings: Settings) {
    this.settings = settings;
  }

  listVoidWarden(): StoredVoidWarden[] {
    return readList<StoredVoidWarden>(this.settings, VOIDWARDEN_KEY);
  }

  addVoidWarden(input: VoidWardenConnectionInput, tokenLabel: string, now = () => new Date()): StoredVoidWarden {
    const entry: StoredVoidWarden = { id: randomUUID(), name: input.name, ...(input.endpoint ? { endpoint: input.endpoint } : {}), tokenLabel, createdAt: now().toISOString() };
    this.settings.set(VOIDWARDEN_KEY, JSON.stringify([...this.listVoidWarden(), entry]));
    return entry;
  }

  updateVoidWarden(id: string, input: VoidWardenConnectionInput, tokenLabel?: string): StoredVoidWarden | null {
    const all = this.listVoidWarden();
    const entry = all.find((e) => e.id === id);
    if (!entry) return null;
    entry.name = input.name;
    if (input.endpoint) entry.endpoint = input.endpoint;
    else delete entry.endpoint;
    if (tokenLabel) entry.tokenLabel = tokenLabel;
    this.settings.set(VOIDWARDEN_KEY, JSON.stringify(all));
    return entry;
  }

  removeVoidWarden(id: string): StoredVoidWarden | null {
    const all = this.listVoidWarden();
    const entry = all.find((e) => e.id === id) ?? null;
    const next = all.filter((e) => e.id !== id);
    if (!entry) return null;
    this.settings.set(VOIDWARDEN_KEY, next.length ? JSON.stringify(next) : null);
    return entry;
  }

  listEndpoints(): StoredEndpoint[] {
    return readList<StoredEndpoint>(this.settings, ENDPOINTS_KEY);
  }

  addEndpoint(input: EndpointEntryInput, now = () => new Date()): StoredEndpoint {
    const entry: StoredEndpoint = {
      id: randomUUID(),
      name: input.name,
      kind: input.kind,
      baseUrl: input.baseUrl,
      apiKeyHash: input.apiKey ? hashSecret(input.apiKey) : null,
      models: [...new Set(input.models)],
      createdAt: now().toISOString(),
      probe: null,
    };
    this.settings.set(ENDPOINTS_KEY, JSON.stringify([...this.listEndpoints(), entry]));
    return entry;
  }

  /** apiKey: undefined = unverändert, null = entfernen, String = ersetzen (als Hash). */
  updateEndpoint(id: string, input: EndpointEntryInput): StoredEndpoint | null {
    const all = this.listEndpoints();
    const entry = all.find((e) => e.id === id);
    if (!entry) return null;
    entry.name = input.name;
    entry.kind = input.kind;
    entry.baseUrl = input.baseUrl;
    if (input.apiKey !== undefined) entry.apiKeyHash = input.apiKey ? hashSecret(input.apiKey) : null;
    entry.models = [...new Set(input.models)];
    this.settings.set(ENDPOINTS_KEY, JSON.stringify(all));
    return entry;
  }

  removeEndpoint(id: string): boolean {
    const all = this.listEndpoints();
    const next = all.filter((e) => e.id !== id);
    if (next.length === all.length) return false;
    this.settings.set(ENDPOINTS_KEY, next.length ? JSON.stringify(next) : null);
    return true;
  }

  recordProbe(id: string, probe: EndpointProbe): StoredEndpoint | null {
    const all = this.listEndpoints();
    const entry = all.find((e) => e.id === id);
    if (!entry) return null;
    entry.probe = probe;
    this.settings.set(ENDPOINTS_KEY, JSON.stringify(all));
    return entry;
  }
}

export type { StoredVoidWarden, StoredEndpoint };

/** Fehlerkode ohne Schlüssel und ohne URL-Query — mehr braucht die Anzeige nicht. */
function probeDetail(err: unknown): string {
  // undici verpackt Verbindungsfehler gern in AggregateError (Happy Eyeballs: IPv4+IPv6).
  const cause = (err as { cause?: { code?: string; errors?: { code?: string }[]; name?: string } })?.cause;
  const code = cause?.code ?? cause?.errors?.[0]?.code ?? cause?.name ?? (err as { name?: string })?.name ?? "fetch failed";
  if (code === "TimeoutError") return `Zeitüberschreitung (${CONNECTION_PROBE_TIMEOUT_MS / 1000} s)`;
  return String(code).slice(0, 80);
}

/**
 * Erreichbarkeits-Check eines Endpoints, ohne Schlüssel: jede HTTP-Antwort —
 * auch 401/403 — beweist, dass der Endpunkt da ist; nur Netzwerkfehler zählen
 * als nicht erreichbar. Der Schlüssel bleibt dabei im Speicher des Hubs und
 * geht nie in URL oder Log (PRD §8).
 */
export async function probeEndpoint(baseUrl: string, fetchImpl: typeof fetch = fetch): Promise<EndpointProbe> {
  const at = new Date().toISOString();
  try {
    const res = await fetchImpl(baseUrl, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(CONNECTION_PROBE_TIMEOUT_MS),
      headers: { "user-agent": "AncientVoid-Hub" },
    });
    await res.body?.cancel().catch(() => undefined);
    return { at, ok: res.status > 0, httpStatus: res.status > 0 ? res.status : null, detail: null };
  } catch (err) {
    return { at, ok: false, httpStatus: null, detail: probeDetail(err) };
  }
}
