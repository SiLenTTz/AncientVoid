import { HIGHLIGHT_MAX_CHARS, HLJS_LANGUAGES, splitHighlighted } from "./render-model.ts";

/** EPIC-P46 T46.7 (ADR-0058 §7): highlight.js lazy und nur mit den gebrauchten Sprachen — kein Monaco im Hauptbündel. */
type Hljs = typeof import("highlight.js/lib/core").default;
let core: Promise<Hljs> | null = null;
const registered = new Set<string>();

const loaders: Record<string, () => Promise<{ default: (hljs: never) => unknown }>> = {
  typescript: () => import("highlight.js/lib/languages/typescript"),
  javascript: () => import("highlight.js/lib/languages/javascript"),
  python: () => import("highlight.js/lib/languages/python"),
  json: () => import("highlight.js/lib/languages/json"),
  yaml: () => import("highlight.js/lib/languages/yaml"),
  markdown: () => import("highlight.js/lib/languages/markdown"),
  xml: () => import("highlight.js/lib/languages/xml"),
  css: () => import("highlight.js/lib/languages/css"),
  bash: () => import("highlight.js/lib/languages/bash"),
  rust: () => import("highlight.js/lib/languages/rust"),
  go: () => import("highlight.js/lib/languages/go"),
  sql: () => import("highlight.js/lib/languages/sql"),
  ini: () => import("highlight.js/lib/languages/ini"),
  diff: () => import("highlight.js/lib/languages/diff"),
};

/** Zeilenweises, bereits von highlight.js escaptes HTML; null = nicht gefärbt (unbekannte Sprache/zu groß/Fehler). */
export async function highlightLines(text: string, language: string): Promise<string[] | null> {
  const name = HLJS_LANGUAGES[language];
  if (!name || text.length > HIGHLIGHT_MAX_CHARS) return null;
  try {
    core ??= import("highlight.js/lib/core").then((m) => m.default);
    const hljs = await core;
    if (!registered.has(name)) {
      const mod = await loaders[name]!();
      hljs.registerLanguage(name, mod.default as never);
      registered.add(name);
    }
    return splitHighlighted(hljs.highlight(text, { language: name, ignoreIllegals: true }).value);
  } catch {
    return null;
  }
}
