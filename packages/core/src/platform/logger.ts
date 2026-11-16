import { REDACT_LOG_KEYS, type HubLogger, type LogFields, type LogLevel } from "@ancientvoid/contracts";

const REDACT_SET = new Set<string>(REDACT_LOG_KEYS);
const REDACTED = "[redacted]";

export function redactFields(value: unknown, key?: string): unknown {
  if (key && REDACT_SET.has(key)) return REDACTED;
  if (Array.isArray(value)) return value.map((item) => redactFields(item));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = redactFields(v, k);
    }
    return out;
  }
  return value;
}

function writeLine(
  sink: (line: string) => void,
  level: LogLevel,
  msg: string,
  base: LogFields,
  fields?: LogFields,
): void {
  const line = JSON.stringify(
    redactFields({
      ts: new Date().toISOString(),
      level,
      msg,
      ...base,
      ...(fields ?? {}),
    }),
  );
  sink(String(line));
}

export function createJsonLogger(
  opts: { write?: (line: string) => void; fields?: LogFields } = {},
): HubLogger {
  const write = opts.write ?? ((line) => process.stdout.write(`${line}\n`));
  const base = opts.fields ?? {};
  return {
    debug: (msg, fields) => writeLine(write, "debug", msg, base, fields),
    info: (msg, fields) => writeLine(write, "info", msg, base, fields),
    warn: (msg, fields) => writeLine(write, "warn", msg, base, fields),
    error: (msg, fields) => writeLine(write, "error", msg, base, fields),
    child: (fields) => createJsonLogger({ write, fields: { ...base, ...fields } }),
  };
}

/**
 * Console-compatible default so existing SessionManager tests keep the
 * same pre-P4.5 noise without requiring every call site to inject a logger.
 */
export function createConsoleLogger(prefix = ""): HubLogger {
  const tag = prefix ? `${prefix} ` : "";
  return {
    debug: (msg, fields) => console.log(`${tag}${msg}`, fields ?? ""),
    info: (msg, fields) => console.log(`${tag}${msg}`, fields ?? ""),
    warn: (msg, fields) => console.warn(`${tag}${msg}`, fields ?? ""),
    error: (msg, fields) => console.error(`${tag}${msg}`, fields ?? ""),
    child: (fields) => {
      const adapter = typeof fields.adapter === "string" ? `[adapter:${fields.adapter}]` : prefix;
      return createConsoleLogger(adapter);
    },
  };
}
