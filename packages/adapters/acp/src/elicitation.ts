/**
 * ACP `elicitation/create` (form mode) ↔ the hub's question form (EPIC-P21 T21.4).
 * An agent asks with a restricted JSON schema; the phone answers the same
 * `AskUserQuestion` shape claude and codex already use, and the answers go
 * back as schema-conformant `content`.
 */
interface ElicitQuestion {
  question: string;
  header?: string;
  options: { label: string; description?: string }[];
  multiSelect: boolean;
  required: boolean;
}

interface Field {
  key: string;
  type: "string" | "number" | "integer" | "boolean" | "array";
  /** label shown on the phone → value the agent expects */
  values: Map<string, string | boolean>;
  question: ElicitQuestion;
}

type Schema = {
  properties?: Record<string, Record<string, unknown>>;
  required?: string[];
};

const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);

function choices(def: Record<string, unknown>): { label: string; value: string; description?: string }[] {
  const oneOf = (def.oneOf ?? def.anyOf) as { const?: unknown; title?: unknown; description?: unknown }[] | undefined;
  if (Array.isArray(oneOf)) {
    return oneOf.filter((o) => typeof o.const === "string").map((o) => ({ value: o.const as string, label: str(o.title) ?? (o.const as string), ...(str(o.description) ? { description: str(o.description)! } : {}) }));
  }
  if (Array.isArray(def.enum)) {
    const names = Array.isArray(def.enumNames) ? (def.enumNames as unknown[]) : [];
    return (def.enum as unknown[]).filter((v) => typeof v === "string").map((v, i) => ({ value: v as string, label: str(names[i]) ?? (v as string) }));
  }
  return [];
}

export function fieldsFromSchema(message: string, schema: Schema): Field[] {
  const props = schema.properties ?? {};
  const keys = Object.keys(props);
  return keys.map((key): Field => {
    const def = props[key]!;
    const type = (def.type as Field["type"]) ?? "string";
    const title = str(def.title) ?? key;
    // A one-field form is the agent's question itself — its message is the better text.
    const text = keys.length === 1 && message ? message : str(def.description) ? `${title}: ${def.description as string}` : title;
    const values = new Map<string, string | boolean>();
    let options: ElicitQuestion["options"] = [];
    let multiSelect = false;
    if (type === "boolean") {
      values.set("Ja", true);
      values.set("Nein", false);
      options = [{ label: "Ja" }, { label: "Nein" }];
    } else if (type === "array") {
      multiSelect = true;
      const items = (def.items ?? {}) as Record<string, unknown>;
      for (const c of choices(items)) {
        values.set(c.label, c.value);
        options.push({ label: c.label, ...(c.description ? { description: c.description } : {}) });
      }
    } else {
      for (const c of choices(def)) {
        values.set(c.label, c.value);
        options.push({ label: c.label, ...(c.description ? { description: c.description } : {}) });
      }
    }
    return { key, type, values, question: { question: text, ...(keys.length > 1 && message ? { header: message.slice(0, 40) } : {}), options, multiSelect, required: schema.required?.includes(key) ?? false } };
  });
}

/** Answers keyed by question text → `content` keyed by schema property; unanswered optional fields are left out. */
export function contentFromAnswers(fields: readonly Field[], answers: Record<string, string>): Record<string, unknown> {
  const content: Record<string, unknown> = {};
  for (const f of fields) {
    const given = answers[f.question.question];
    if (given === undefined || given === "") continue;
    if (f.type === "array") {
      const picked = [...f.values.keys()].filter((label) => given.split(", ").includes(label));
      content[f.key] = (picked.length > 0 ? picked.map((l) => f.values.get(l)) : given.split(",").map((s) => s.trim()).filter(Boolean)) as unknown[];
    } else if (f.type === "boolean") {
      const v = f.values.get(given);
      if (typeof v === "boolean") content[f.key] = v;
    } else if (f.type === "number" || f.type === "integer") {
      const n = Number(given.replace(",", "."));
      if (Number.isFinite(n)) content[f.key] = f.type === "integer" ? Math.trunc(n) : n;
    } else {
      content[f.key] = f.values.get(given) ?? given;
    }
  }
  return content;
}
