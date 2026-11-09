/**
 * EPIC-P46 T46.6/T46.7 (ADR-0058 §7–§8): reine Funktionen für die Dateiansichten — ohne DOM, damit sie
 * unit-testbar sind. Nichts hiervon erzeugt HTML aus Dateiinhalt; Darstellung übernimmt Preact (Text-Knoten).
 */

/** Teilt hljs-HTML in Zeilen und schließt/öffnet Spans an Zeilengrenzen, damit jede Zeile für sich gültig ist. */
export function splitHighlighted(html: string): string[] {
  const lines: string[] = [];
  const open: string[] = [];
  let cur = "";
  const re = /<span[^>]*>|<\/span>|\n|[^<\n]+|</g;
  for (const m of html.matchAll(re)) {
    const tok = m[0];
    if (tok === "\n") {
      lines.push(cur + "</span>".repeat(open.length));
      cur = open.join("");
    } else {
      if (tok.startsWith("<span")) open.push(tok);
      else if (tok === "</span>") open.pop();
      cur += tok;
    }
  }
  lines.push(cur + "</span>".repeat(open.length));
  return lines;
}

export const HLJS_LANGUAGES: Record<string, string> = {
  typescript: "typescript", tsx: "typescript", javascript: "javascript", jsx: "javascript", python: "python", json: "json",
  yaml: "yaml", markdown: "markdown", html: "xml", xml: "xml", css: "css", bash: "bash", shell: "bash", sh: "bash",
  rust: "rust", go: "go", sql: "sql", toml: "ini", ini: "ini", diff: "diff",
};

/** Ab dieser Abschnittsgröße keine Syntaxfarben (Speicher/Zeit); der Text bleibt vollständig lesbar. */
export const HIGHLIGHT_MAX_CHARS = 120_000;

// ---- CSV/TSV (RFC-4180-nah, mit Anführungszeichen und Zeilenumbrüchen in Feldern) ------------------------------
export const CSV_MAX_BYTES = 2 * 1024 * 1024;

export function parseDelimited(text: string, delimiter: "," | "\t" | ";"): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
    } else if (c === '"' && field === "") quoted = true;
    else if (c === delimiter) { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += c;
  }
  if (field !== "" || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

export function guessDelimiter(path: string, head: string): "," | "\t" | ";" {
  if (path.toLowerCase().endsWith(".tsv")) return "\t";
  const first = head.split(/\r?\n/, 1)[0] ?? "";
  const count = (ch: string) => first.split(ch).length - 1;
  return count(";") > count(",") ? ";" : ",";
}

// ---- JSON-Struktur --------------------------------------------------------------------------------------------
export type JsonNode = { key: string; kind: "object" | "array" | "string" | "number" | "boolean" | "null"; preview: string; children: JsonNode[] | null };

export function jsonNodes(value: unknown, key: string, depth = 0, budget = { n: 2000 }): JsonNode {
  budget.n--;
  if (value === null) return { key, kind: "null", preview: "null", children: null };
  if (Array.isArray(value)) {
    const children = depth < 12 && budget.n > 0 ? value.slice(0, 200).map((v, i) => jsonNodes(v, String(i), depth + 1, budget)) : [];
    return { key, kind: "array", preview: `[${value.length}]`, children };
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    const children = depth < 12 && budget.n > 0 ? entries.slice(0, 200).map(([k, v]) => jsonNodes(v, k, depth + 1, budget)) : [];
    return { key, kind: "object", preview: `{${entries.length}}`, children };
  }
  if (typeof value === "string") return { key, kind: "string", preview: JSON.stringify(value.length > 200 ? `${value.slice(0, 200)}…` : value), children: null };
  if (typeof value === "number") return { key, kind: "number", preview: String(value), children: null };
  return { key, kind: "boolean", preview: String(value), children: null };
}

// ---- Markdown (eigener, kleiner Block-Parser; Ausgabe sind Datenstrukturen, kein HTML) ----------------------
export type MdInline = { t: "text" | "code" | "strong" | "em" | "link"; text: string; href?: string };
export type MdBlock =
  | { t: "heading"; level: number; inline: MdInline[] }
  | { t: "para"; inline: MdInline[] }
  | { t: "code"; lang: string; text: string }
  | { t: "list"; ordered: boolean; items: MdInline[][] }
  | { t: "quote"; inline: MdInline[] }
  | { t: "rule" }
  | { t: "table"; head: string[]; rows: string[][] };

/** Nur http(s)/mailto-Links und relative Pfade; alles andere (javascript:, data:, …) wird zu Text. */
export function safeHref(href: string): string | null {
  const h = href.trim();
  if (/^(https?:|mailto:)/i.test(h)) return h;
  if (/^[a-z][a-z0-9+.-]*:/i.test(h) || h.startsWith("//")) return null;
  return h;
}

export function parseInline(src: string): MdInline[] {
  const out: MdInline[] = [];
  const re = /`([^`]+)`|\*\*([^*]+)\*\*|\*([^*\s][^*]*)\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  for (const m of src.matchAll(re)) {
    if (m.index! > last) out.push({ t: "text", text: src.slice(last, m.index) });
    if (m[1] !== undefined) out.push({ t: "code", text: m[1] });
    else if (m[2] !== undefined) out.push({ t: "strong", text: m[2] });
    else if (m[3] !== undefined) out.push({ t: "em", text: m[3] });
    else {
      const href = safeHref(m[5]!);
      out.push(href ? { t: "link", text: m[4]!, href } : { t: "text", text: m[0] });
    }
    last = m.index! + m[0].length;
  }
  if (last < src.length) out.push({ t: "text", text: src.slice(last) });
  return out;
}

export function parseMarkdown(src: string): MdBlock[] {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const blocks: MdBlock[] = [];
  for (let i = 0; i < lines.length; ) {
    const line = lines[i]!;
    const fence = /^```\s*([\w+-]*)/.exec(line);
    if (fence) {
      const body: string[] = [];
      for (i++; i < lines.length && !/^```/.test(lines[i]!); i++) body.push(lines[i]!);
      i++;
      blocks.push({ t: "code", lang: fence[1] ?? "", text: body.join("\n") });
    } else if (/^\s*$/.test(line)) i++;
    else if (/^(-{3,}|\*{3,})\s*$/.test(line)) { blocks.push({ t: "rule" }); i++; }
    else if (/^#{1,6}\s/.test(line)) {
      const m = /^(#{1,6})\s+(.*)$/.exec(line)!;
      blocks.push({ t: "heading", level: m[1]!.length, inline: parseInline(m[2]!) });
      i++;
    } else if (/^\s*([-*+]|\d+\.)\s/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items: MdInline[][] = [];
      for (; i < lines.length && /^\s*([-*+]|\d+\.)\s/.test(lines[i]!); i++) items.push(parseInline(lines[i]!.replace(/^\s*([-*+]|\d+\.)\s+/, "")));
      blocks.push({ t: "list", ordered, items });
    } else if (/^>\s?/.test(line)) {
      const body: string[] = [];
      for (; i < lines.length && /^>\s?/.test(lines[i]!); i++) body.push(lines[i]!.replace(/^>\s?/, ""));
      blocks.push({ t: "quote", inline: parseInline(body.join(" ")) });
    } else if (line.includes("|") && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1] ?? "")) {
      const cells = (l: string) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      const head = cells(line);
      const rows: string[][] = [];
      for (i += 2; i < lines.length && lines[i]!.includes("|"); i++) rows.push(cells(lines[i]!));
      blocks.push({ t: "table", head, rows });
    } else {
      const body: string[] = [];
      for (; i < lines.length && !/^\s*$/.test(lines[i]!) && !/^(#{1,6}\s|```|>\s?|\s*([-*+]|\d+\.)\s)/.test(lines[i]!); i++) body.push(lines[i]!);
      blocks.push({ t: "para", inline: parseInline(body.join(" ")) });
    }
  }
  return blocks;
}

// ---- Notebook (nur lesen; nichts wird ausgeführt) ----------------------------------------------------------------
export interface NotebookCell {
  kind: "markdown" | "code" | "raw";
  source: string;
  outputs: { kind: "text" | "image" | "other"; text?: string; dataUri?: string; label?: string }[];
}

const joinSource = (v: unknown): string => (Array.isArray(v) ? v.join("") : typeof v === "string" ? v : "");

export function parseNotebook(text: string): { ok: true; cells: NotebookCell[] } | { ok: false; reason: string } {
  let nb: { cells?: unknown };
  try {
    nb = JSON.parse(text) as { cells?: unknown };
  } catch (err) {
    return { ok: false, reason: `Kein gültiges JSON: ${err instanceof Error ? err.message : "Syntaxfehler"}` };
  }
  if (!nb || !Array.isArray(nb.cells)) return { ok: false, reason: "Kein Notebook (kein „cells“-Feld)." };
  const cells: NotebookCell[] = nb.cells.slice(0, 2000).map((raw) => {
    const c = raw as { cell_type?: string; source?: unknown; outputs?: unknown };
    const outputs = (Array.isArray(c.outputs) ? c.outputs : []).slice(0, 50).map((o): NotebookCell["outputs"][number] => {
      const out = o as { output_type?: string; text?: unknown; data?: Record<string, unknown>; ename?: string; evalue?: string };
      if (out.output_type === "stream") return { kind: "text", text: joinSource(out.text) };
      if (out.output_type === "error") return { kind: "text", text: `${out.ename ?? "Fehler"}: ${out.evalue ?? ""}` };
      const data = out.data ?? {};
      const png = joinSource(data["image/png"]).replace(/\s/g, "");
      // Nur gültiges Base64 als passives <img>; alles andere wird benannt, nicht gerendert.
      if (png && /^[A-Za-z0-9+/=]+$/.test(png)) return { kind: "image", dataUri: `data:image/png;base64,${png}` };
      if (data["text/plain"] !== undefined) return { kind: "text", text: joinSource(data["text/plain"]) };
      return { kind: "other", label: `Ausgabe (${Object.keys(data).join(", ") || out.output_type || "unbekannt"}) wird nicht dargestellt` };
    });
    return { kind: c.cell_type === "markdown" ? "markdown" : c.cell_type === "code" ? "code" : "raw", source: joinSource(c.source), outputs };
  });
  return { ok: true, cells };
}

/** Wie viele Zeilen eines Bereichs in den Feedback-Auszug passen (Spiegel der Server-Grenze). */
export const FEEDBACK_MAX_LINES = 40;
