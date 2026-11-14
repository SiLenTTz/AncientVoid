import { useEffect, useState } from "preact/hooks";

/**
 * EPIC-P43.5 T43.5-1: Quellen für den Prompt — Code-Stellen, Reviewnotizen,
 * Test-/CI-Befunde als sichtbare Chips im Composer. Flüchtig wie Anhänge
 * (localStorage, target-gebunden: Session-ID oder „new“), kein kanonischer
 * Zustand (K7). Senden ist immer die bewusste Handlung des Menschen: die
 * Chips wandern erst beim Absenden als markierter Block in den Prompt
 * (`sourcesBlock`, K5-gekappt), vorher steht derselbe Block in der Vorschau.
 */

export type SourceKind = "code" | "review" | "test" | "forge";

export interface SourceRef {
  id: string;
  kind: SourceKind;
  /** Kurzform für den Chip, z. B. „apps/x.ts:12–18“ oder „Pipeline #42 · test“. */
  label: string;
  /** Mitgeltender Auszug (max. 400 Zeichen, wie DiffReview-Exzerpte). */
  excerpt: string | null;
  /** Sprungziel (Hash) für „Quelle ansehen“; null = kein Sprung möglich. */
  hash: string | null;
  view?: "forge";
}

/** K5: Der Quellenblock bleibt klein — Exzerpte gekappt, Anzahl begrenzt. */
const MAX_SOURCES = 6;
const MAX_EXCERPT = 400;
const MAX_BLOCK = 2048;

export const SOURCES_EVENT = "ancientvoid:sources";

const keyOf = (target: string) => `ancientvoid.sources.${target}`;

function read(target: string): SourceRef[] {
  try {
    const raw = localStorage.getItem(keyOf(target));
    const parsed = raw ? (JSON.parse(raw) as SourceRef[]) : [];
    return Array.isArray(parsed) ? parsed.filter((s) => s && typeof s.id === "string" && typeof s.label === "string" && ["code", "review", "test", "forge"].includes(s.kind)).slice(0, MAX_SOURCES).map(s => ({ id: s.id, kind: s.kind, label: s.label.slice(0, 160), excerpt: typeof s.excerpt === "string" ? s.excerpt.slice(0, MAX_EXCERPT) : null, hash: typeof s.hash === "string" && /^#?\//.test(s.hash) ? s.hash : null, ...(s.view === "forge" ? { view: "forge" as const } : {}) })) : [];
  } catch {
    return [];
  }
}

function write(target: string, sources: SourceRef[]): void {
  if (sources.length === 0) localStorage.removeItem(keyOf(target));
  else localStorage.setItem(keyOf(target), JSON.stringify(sources.slice(0, MAX_SOURCES)));
  window.dispatchEvent(new CustomEvent(SOURCES_EVENT, { detail: target }));
}

export function addSource(target: string, ref: SourceRef): SourceRef[] {
  const next = [...read(target).filter((s) => s.id !== ref.id), { ...ref, label: ref.label.slice(0, 160), excerpt: ref.excerpt ? ref.excerpt.slice(0, MAX_EXCERPT) : null }].slice(-MAX_SOURCES);
  write(target, next);
  return next;
}

export function removeSource(target: string, id: string): SourceRef[] {
  const next = read(target).filter((s) => s.id !== id);
  write(target, next);
  return next;
}

export function sourcesOf(target: string): SourceRef[] {
  return read(target);
}

/** Verbraucht die Quellen beim Absenden — der Block ist dann im Prompt. */
export function takeSources(target: string): SourceRef[] {
  const sources = read(target);
  if (sources.length > 0) write(target, []);
  return sources;
}

export function useSources(target: string | undefined): SourceRef[] {
  const [sources, setSources] = useState<SourceRef[]>(() => (target ? read(target) : []));
  useEffect(() => {
    if (!target) return;
    const sync = (e: Event) => {
      if ((e as CustomEvent<string>).detail === target) setSources(read(target));
    };
    setSources(read(target));
    const storage = (e: StorageEvent) => { if (e.key === keyOf(target) || e.key === null) setSources(read(target)); };
    window.addEventListener(SOURCES_EVENT, sync);
    window.addEventListener("storage", storage);
    return () => { window.removeEventListener(SOURCES_EVENT, sync); window.removeEventListener("storage", storage); };
  }, [target]);
  return sources;
}

const KIND_LABEL: Record<SourceKind, string> = { code: "Code", review: "Review", test: "Test", forge: "CI" };

/**
 * Der Block, der beim Absenden an den Prompt tritt — dieselbe Form, die die
 * Vorschau zeigt. Nummeriert, mit Typ, damit der Agent Zitate sauber
 * referenzieren kann; hart auf `MAX_BLOCK` Bytes gekappt. Große Gesamtprompts lagert der Hub aus (K5).
 */
function clippedUtf8(text: string, maxBytes: number): string {
  const encoder = new TextEncoder();
  if (encoder.encode(text).length <= maxBytes) return text;
  let result = "";
  let bytes = 0;
  for (const ch of text) {
    const size = encoder.encode(ch).length;
    if (bytes + size + 3 > maxBytes) break;
    result += ch;
    bytes += size;
  }
  return `${result}…`;
}

export function sourcesBlock(sources: SourceRef[]): string {
  const selected = sources.slice(0, MAX_SOURCES);
  if (selected.length === 0) return "";
  const encoder = new TextEncoder();
  const opening = "<quellen>\n", closing = "\n</quellen>";
  // Jede Referenz erhält Platz: große frühe Auszüge dürfen spätere Quellen nicht verdrängen.
  const budget = Math.floor((MAX_BLOCK - encoder.encode(opening + closing).length - selected.length + 1) / selected.length);
  const lines = selected.map((s, index) => {
    const prefix = `[${index + 1}] ${KIND_LABEL[s.kind]} — `;
    const framing = encoder.encode("\n«»").length;
    const reserve = s.excerpt ? framing + 64 : 0;
    const header = prefix + clippedUtf8(s.label, budget - encoder.encode(prefix).length - reserve);
    const remaining = budget - encoder.encode(header).length - framing;
    return s.excerpt ? `${header}\n«${clippedUtf8(s.excerpt.slice(0, MAX_EXCERPT), remaining)}»` : header;
  });
  return opening + lines.join("\n") + closing;
}

export function jumpToSource(source: { hash: string | null; view?: "forge" }): void {
  if (!source.hash) return;
  if (source.view) sessionStorage.setItem("ancientvoid.source-view", JSON.stringify({ hash: source.hash, view: source.view }));
  location.hash = source.hash;
  window.dispatchEvent(new CustomEvent("ancientvoid:source-jump"));
}

/** Ein Ack bestätigt genau diesen Stand, nicht inzwischen hinzugefügte Quellen. */
export function consumeSources(target: string, submitted: SourceRef[]): void {
  if (submitted.length === 0) return;
  const sent = new Map(submitted.map(s => [s.id, JSON.stringify(s)]));
  write(target, read(target).filter(s => sent.get(s.id) !== JSON.stringify(s)));
}
