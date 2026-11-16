import { z } from "zod";

/**
 * Verbindungs-Registry (Optionsbereich der PWA): VoidWarden-Instanzen und
 * Modell-/Tool-Endpoints. Beide Listen leben in der `config`-Tabelle des Hubs
 * (Backup/Recovery wie jede Einstellung, K7) und enthalten niemals Secrets im
 * Klartext: Zugangsdaten werden als sha256-Hash abgelegt und sind über die API
 * write-only (die Antwort sagt nur, ob einer gesetzt ist — Muster wie der
 * Gemini-Schlüssel, T7.10).
 */

/** Obergrenzen: die Listen sind Konfiguration, keine Ereignisströme — trotzdem begrenzt, damit Antworten klein bleiben. */
export const CONNECTIONS_MAX_VOIDWARDEN = 16;
export const CONNECTIONS_MAX_ENDPOINTS = 32;
export const CONNECTIONS_MAX_MODELS = 50;
export const CONNECTION_PROBE_TIMEOUT_MS = 5_000;

const HttpUrl = z
  .string()
  .trim()
  .url()
  .max(300)
  .refine((u) => /^https?:\/\//i.test(u), "nur http(s)");

/** Eine VoidWarden-Instanz (Companion auf dem Handy/Tablet, ESP32-Board über den Companion). */
export const VoidWardenConnectionInput = z.object({
  name: z.string().trim().min(1).max(80),
  /** Endpunkt der Instanz, z. B. URL des Companions — Dokumentation für den Nutzer, der Hub ruft ihn nicht an. */
  endpoint: HttpUrl.optional(),
});
export type VoidWardenConnectionInput = z.infer<typeof VoidWardenConnectionInput>;

/** Was vom Hub zurückkommt: nie das Token selbst, nur wann es zuletzt benutzt wurde. */
export interface VoidWardenConnectionView {
  id: string;
  name: string;
  endpoint?: string;
  /** Label des gehörenden read-only-Tokens (`agent:vw-…`) — sichtbar, damit es von der Token-Liste unterscheidbar bleibt. */
  tokenLabel: string;
  createdAt: string;
  /** Letzte authentifizierte Anfrage dieses Tokens an den Hub; null = noch nie gemeldet. */
  lastSeenAt: string | null;
}

export const ENDPOINT_KINDS = ["llm", "image", "video", "other"] as const;
export type EndpointKind = (typeof ENDPOINT_KINDS)[number];

/** Ein generischer Modell-/Tool-Endpoint (LLM, Bild-, Videoerkennung, Sonstiges). */
export const EndpointEntryInput = z.object({
  name: z.string().trim().min(1).max(80),
  kind: z.enum(ENDPOINT_KINDS),
  baseUrl: HttpUrl,
  /** Write-only: undefined = unverändert, null = entfernen, String = ersetzen. Gespeichert wird nur der Hash. */
  apiKey: z.string().trim().min(8).max(300).nullable().optional(),
  /** Aktivierte Modelle an diesem Endpoint (freie Ids, z. B. anbieter/modell). */
  models: z.array(z.string().trim().min(1).max(200)).max(CONNECTIONS_MAX_MODELS).default([]),
});
export type EndpointEntryInput = z.infer<typeof EndpointEntryInput>;

/** Ergebnis eines Erreichbarkeits-Checks. `detail` trägt nie einen Schlüssel, nur HTTP-Status bzw. Fehlerkode. */
export interface EndpointProbe {
  at: string;
  ok: boolean;
  /** HTTP-Status der Antwort — auch 401/403 beweist Erreichbarkeit; ohne Antwort null. */
  httpStatus: number | null;
  detail: string | null;
}

export interface EndpointEntryView {
  id: string;
  name: string;
  kind: EndpointKind;
  baseUrl: string;
  /** true = es ist ein Schlüssel hinterlegt (Hash im Speicher des Hubs, nie im Klartext auslesbar). */
  hasKey: boolean;
  models: string[];
  createdAt: string;
  probe: EndpointProbe | null;
}
