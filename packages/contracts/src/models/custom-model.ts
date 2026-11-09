import { z } from "zod";

/**
 * ADR-0060: eigene Modelle und Endpunkte. Ein Eintrag im Hub-Register ergänzt den Modell-Katalog
 * der Harnesses um eine Id, die der Harness selbst nicht auflistet (z. B. ein Modell auf dem
 * eigenen Server oder ein Anbieter, dessen Anmeldung der Harness erst beim Start prüft).
 * Der Hub reicht die Id unverändert als `--model` durch — kennt der Harness sie nicht, scheitert
 * der Zug sichtbar mit dessen Fehler (ADR-0054 §5), nie auf einem Ersatzmodell.
 */
export const CustomModelInput = z.object({
  id: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .regex(/^[\w@:.+-]+(?:\/[\w@:.+-]+)*$/, "Modell-Id wie anbieter/modell"),
  label: z.string().trim().min(1).max(80).optional(),
  /** Adapter-Ids, in deren Auswahl das Modell erscheint; leer = in allen mit Modellwahl. */
  adapters: z.array(z.string().trim().min(1).max(64)).max(32).default([]),
});
export type CustomModelInput = z.infer<typeof CustomModelInput>;

export interface CustomModel {
  id: string;
  label?: string;
  adapters: string[];
}

/** pi-Provider-Eintrag für `~/.pi/agent/models.json` (dokumentiertes Schema, pi docs/models.md). */
export const PI_PROVIDER_APIS = ["openai-completions", "anthropic-messages", "google-generative-ai"] as const;

export const PiProviderInput = z.object({
  name: z.string().trim().regex(/^[a-z0-9][a-z0-9_-]{0,39}$/, "Kleinbuchstaben, Ziffern, - und _"),
  baseUrl: z
    .string()
    .trim()
    .url()
    .max(300)
    .refine((u) => /^https?:\/\//i.test(u), "nur http(s)"),
  api: z.enum(PI_PROVIDER_APIS).default("openai-completions"),
  /** `$NAME` (Umgebungsvariable, empfohlen) oder ein Literal; der Hub speichert/loggt es nicht selbst. */
  apiKey: z.string().trim().min(1).max(300).optional(),
  models: z
    .array(
      z.object({
        id: z.string().trim().min(1).max(200),
        name: z.string().trim().min(1).max(80).optional(),
        contextWindow: z.number().int().min(1024).max(10_000_000).optional(),
        maxTokens: z.number().int().min(1).max(10_000_000).optional(),
        reasoning: z.boolean().optional(),
      }),
    )
    .min(1)
    .max(50),
});
export type PiProviderInput = z.infer<typeof PiProviderInput>;
