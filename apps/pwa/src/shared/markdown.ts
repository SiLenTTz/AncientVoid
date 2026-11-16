/**
 * BUG-0067: the Markdown agents write, as plain data. Rendering builds
 * Preact nodes from this tree — never innerHTML — so agent text cannot
 * become markup or script (PRD §8.5). Covers what agent answers use:
 * headings, paragraphs, lists, fenced code, tables, quotes, rules, and
 * strong/em/del/code/links inline. Anything else stays literal text.
 */

export type Inline =
  | { kind: "text"; text: string }
  | { kind: "code"; text: string }
  | { kind: "strong" | "em" | "del"; children: Inline[] }
  | { kind: "link"; href: string; children: Inline[] };

interface ListItem {
  content: Inline[];
  children: Block[];
}

export type Block =
  | { kind: "heading"; level: number; content: Inline[] }
  | { kind: "paragraph"; lines: Inline[][] }
  | { kind: "code"; lang: string; text: string }
  | { kind: "list"; ordered: boolean; start: number; items: ListItem[] }
  | { kind: "table"; head: Inline[][]; rows: Inline[][][] }
  | { kind: "quote"; blocks: Block[] }
  | { kind: "rule" };

const FENCE = /^\s{0,3}(`{3,}|~{3,})\s*([\w+-]*)/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const ITEM = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

function isTableRow(line: string): boolean {
  return line.includes("|") && line.trim().length > 1;
}

function cells(line: string): string[] {
  let t = line.trim();
  if (t.startsWith("|")) t = t.slice(1);
  if (t.endsWith("|") && !t.endsWith("\\|")) t = t.slice(0, -1);
  return t.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));
}

function startsBlock(line: string, next: string | undefined): boolean {
  return FENCE.test(line) || HEADING.test(line) || RULE.test(line) || ITEM.test(line) || /^\s{0,3}>/.test(line) || (isTableRow(line) && next !== undefined && TABLE_SEP.test(next));
}

export function parseMarkdown(source: string): Block[] {
  return parseLines(source.replace(/\r\n?/g, "\n").split("\n"));
}

function parseLines(lines: string[]): Block[] {
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) {
      i++;
      continue;
    }
    const fence = FENCE.exec(line);
    if (fence) {
      const marker = fence[1]!;
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.trimStart().startsWith(marker)) body.push(lines[i++]!);
      i++; // closing fence (or past the end: an unclosed block runs to the end)
      blocks.push({ kind: "code", lang: fence[2] ?? "", text: body.join("\n") });
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({ kind: "heading", level: heading[1]!.length, content: parseInline(heading[2]!) });
      i++;
      continue;
    }
    if (RULE.test(line)) {
      blocks.push({ kind: "rule" });
      i++;
      continue;
    }
    if (/^\s{0,3}>/.test(line)) {
      const inner: string[] = [];
      while (i < lines.length && /^\s{0,3}>/.test(lines[i]!)) inner.push(lines[i++]!.replace(/^\s{0,3}>\s?/, ""));
      blocks.push({ kind: "quote", blocks: parseLines(inner) });
      continue;
    }
    if (isTableRow(line) && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1]!)) {
      const head = cells(line).map(parseInline);
      i += 2;
      const rows: Inline[][][] = [];
      while (i < lines.length && isTableRow(lines[i]!) && lines[i]!.trim()) rows.push(cells(lines[i++]!).map(parseInline));
      blocks.push({ kind: "table", head, rows });
      continue;
    }
    if (ITEM.test(line)) {
      const [list, next] = parseList(lines, i);
      blocks.push(list);
      i = next;
      continue;
    }
    const para: Inline[][] = [];
    while (i < lines.length && lines[i]!.trim() && !(para.length > 0 && startsBlock(lines[i]!, lines[i + 1]))) {
      para.push(parseInline(lines[i]!.trim()));
      i++;
    }
    blocks.push({ kind: "paragraph", lines: para });
  }
  return blocks;
}

function parseList(lines: string[], from: number): [Block, number] {
  const first = ITEM.exec(lines[from]!)!;
  const indent = first[1]!.length;
  const ordered = /\d/.test(first[2]!);
  const items: ListItem[] = [];
  let i = from;
  while (i < lines.length) {
    const m = ITEM.exec(lines[i]!);
    if (!m || m[1]!.length !== indent || /\d/.test(m[2]!) !== ordered) break;
    const text = [m[3]!];
    const nested: string[] = [];
    i++;
    // Continuation: deeper-indented lines belong to this item; a blank
    // line followed by a deeper line too.
    while (i < lines.length) {
      const l = lines[i]!;
      const deeper = l.trim() !== "" && l.length - l.trimStart().length > indent;
      if (deeper) {
        if (nested.length === 0 && !ITEM.test(l)) text.push(l.trim());
        else nested.push(l);
        i++;
      } else if (!l.trim() && i + 1 < lines.length && lines[i + 1]!.length - lines[i + 1]!.trimStart().length > indent && lines[i + 1]!.trim()) {
        nested.push("");
        i++;
      } else break;
    }
    items.push({ content: parseInline(text.join(" ")), children: nested.length ? parseLines(dedent(nested)) : [] });
    while (i < lines.length && !lines[i]!.trim() && i + 1 < lines.length && ITEM.test(lines[i + 1]!) && ITEM.exec(lines[i + 1]!)![1]!.length === indent) i++;
  }
  return [{ kind: "list", ordered, start: ordered ? Number.parseInt(first[2]!, 10) : 1, items }, i];
}

function dedent(lines: string[]): string[] {
  const widths = lines.filter((l) => l.trim()).map((l) => l.length - l.trimStart().length);
  const cut = widths.length ? Math.min(...widths) : 0;
  return lines.map((l) => l.slice(Math.min(cut, l.length - l.trimStart().length)));
}

const SAFE_HREF = /^(https?:\/\/|mailto:)/i;
// Order matters: code spans first, so nothing inside them is parsed.
const INLINE = /(`+)([\s\S]*?[^`])\1(?!`)|\*\*(?=\S)([\s\S]*?\S)\*\*|__(?=\S)([\s\S]*?\S)__(?![\w])|~~(?=\S)([\s\S]*?\S)~~|(?<![\w*])\*(?=[^\s*])([^*]*?[^\s*])\*(?![\w*])|(?<![\w])_(?=\S)([^_]*?\S)_(?![\w])|\[([^\]\n]+)\]\(([^)\s]+)\)|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"\]])/g;

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  const push = (node: Inline) => {
    const prev = out[out.length - 1];
    if (node.kind === "text" && prev?.kind === "text") prev.text += node.text;
    else out.push(node);
  };
  for (const m of text.matchAll(INLINE)) {
    const at = m.index;
    if (at > last) push({ kind: "text", text: text.slice(last, at) });
    last = at + m[0].length;
    if (m[1] !== undefined) push({ kind: "code", text: m[2]!.replace(/^ (.*) $/, "$1") });
    else if (m[3] !== undefined || m[4] !== undefined) push({ kind: "strong", children: parseInline((m[3] ?? m[4])!) });
    else if (m[5] !== undefined) push({ kind: "del", children: parseInline(m[5]) });
    else if (m[6] !== undefined || m[7] !== undefined) push({ kind: "em", children: parseInline((m[6] ?? m[7])!) });
    else if (m[8] !== undefined) {
      if (SAFE_HREF.test(m[9]!)) push({ kind: "link", href: m[9]!, children: parseInline(m[8]) });
      else push({ kind: "text", text: m[0] });
    } else if (m[10] !== undefined) push({ kind: "link", href: m[10], children: [{ kind: "text", text: m[10] }] });
  }
  if (last < text.length) push({ kind: "text", text: text.slice(last) });
  return out;
}
