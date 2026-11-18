import { homedir } from "node:os";
import { resolve } from "node:path";
import type { HubConfig } from "@ancientvoid/core";
import type { SttConfig } from "./stt.routes.ts";

/**
 * BUG-0216: Uebersetzt `stt` aus der Konfig-Datei in das Sprachmodul.
 *
 * Der Grund fuer eine eigene Datei ist nicht Schoheit, sondern der Diebstahl durch
 * die Mitte: `stt.routes.ts` und `stt-stream.ts` haben `stt.streaming.engine` beide
 * richtig gelesen, der Schluessel ist aber im Handanlegen des Objekts in `main.ts`
 * unter den Tisch gefallen — jedes streamende Diktat endete mit dem fremden
 * Produktnamen. Hier liegt die ganze Weitergabe an einer Stelle, und die Unit
 * (`apps/hub/test/modules/voice/stt-wiring.test.ts`) haelt sie vollstaendig.
 */
export function sttModuleConfig(stt: HubConfig["stt"]): SttConfig | undefined {
  if (!stt) return undefined;
  return {
    url: stt.url,
    engine: stt.engine,
    language: stt.language,
    vocabulary: stt.vocabulary,
    timeoutMs: stt.timeoutMs,
    ...(stt.streaming
      ? {
          streaming: {
            url: stt.streaming.url,
            endpointingMs: stt.streaming.endpointingMs,
            ...(stt.streaming.engine ? { engine: stt.streaming.engine } : {}),
            ...(stt.streaming.apiKeyFile
              ? { apiKeyFile: resolve(stt.streaming.apiKeyFile.replace(/^~(?=\/)/, homedir())) }
              : {}),
          },
        }
      : {}),
  };
}
