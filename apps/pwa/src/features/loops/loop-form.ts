import { LOOP_NEW } from "@uacc/contracts";
import type { LoopInfo, LoopSpec } from "@uacc/contracts";

/** Eingaben des Formulars „Neues Repo anbinden“ — das Geheimnis bleibt im Speicher dieses Formulars. */
export interface OnboardDraft {
  values: Record<string, string>;
  secret: string;
}

export const emptyOnboard: OnboardDraft = { values: {}, secret: "" };

/** Öffnet die Auswahl das Anbinden-Formular? */
export function isOnboarding(info: LoopInfo | null, spec: LoopSpec | null): boolean {
  const ob = info?.capabilities?.onboarding;
  return !!ob && spec?.options?.[ob.optionKey] === LOOP_NEW;
}

/** Startvorgabe für einen frisch gewählten Loop: Voreinstellungen kommen vom Loop, „riskant“ ist nie die Vorgabe. */
export function defaultLoopSpec(info: LoopInfo): LoopSpec {
  const caps = info.capabilities;
  if (!caps) return { id: info.id };
  const mode = caps.modes.find((m) => !caps.riskyModes.includes(m)) ?? caps.modes[0];
  const orchestrator = caps.orchestrators[0];
  const options: Record<string, string> = {};
  for (const o of caps.options) {
    if (o.kind === "select" && o.choices?.[0]) options[o.key] = o.choices[0].value;
    if (o.kind === "toggle") options[o.key] = "false";
  }
  return { id: info.id, ...(mode ? { mode } : {}), ...(orchestrator ? { orchestrator } : {}), options };
}

/** Was vor dem Start noch fehlt — null heißt: startbar. Die Antwort ist ein Satz für die Oberfläche. */
export function loopBlocker(info: LoopInfo | null, spec: LoopSpec | null, confirmed: boolean, onboard: OnboardDraft = emptyOnboard): string | null {
  if (!info || !spec) return null;
  const caps = info.capabilities;
  if (!info.available || !caps) return info.reason ?? "Loop nicht verbunden";
  const ob = caps.onboarding;
  if (ob && isOnboarding(info, spec)) {
    for (const f of ob.fields) if (f.required && !onboard.values[f.key]?.trim()) return `${f.label} fehlt`;
    if (ob.secret && !onboard.secret.trim()) return `${ob.secret.label} fehlt`;
  }
  for (const o of caps.options) {
    if (ob && o.key === ob.optionKey && isOnboarding(info, spec)) continue;
    if (o.required && !spec.options?.[o.key]?.trim()) return `${o.label} fehlt`;
  }
  if (spec.mode && caps.riskyModes.includes(spec.mode) && !confirmed) return `Betriebsart „${spec.mode}“ braucht deine Bestätigung`;
  return null;
}
