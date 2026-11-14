import { useEffect, useState } from "preact/hooks";

/**
 * EPIC-P43.5 T43.5-1: Quellen für den Prompt — Code-Stellen, Reviewnotizen,
 * Test-/CI-Befunde als sichtbare Chips im Composer. Flüchtig wie Anhänge
 * (sessionStorage, target-gebunden: Session-ID oder „new“), kein kanonischer
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
}

/** K5: Der Quellenblock bleibt klein — Exzerpte gekappt, Anzahl begrenzt. */
const MAX_SOURCES = 6;
const MAX_EXCERPT = 400;
const MAX_BLOCK = 2048;

const SOURCES_EVENT = "ancientvoid:sources";

const keyOf = (target: string) => `ancientvoid.sources.${target}`;

function read(target: string): SourceRef[] {
  try {
    const raw = sessionStorage.getItem(keyOf(target));
    const parsed = raw ? (JSON.parse(raw) as SourceRef[]) : [];
    return Array.isArray(parsed) ? parsed.filter((s) => typeof s?.id === "string" && typeof s?.label === "string").slice(0, MAX_SOURCES) : [];
  } catch {
    return [];
  }
}

function write(target: string, sources: SourceRef[]): void {
  if (sources.length === 0) sessionStorage.removeItem(keyOf(target));
  else sessionStorage.setItem(keyOf(target), JSON.stringify(sources.slice(0, MAX_SOURCES)));
  window.dispatchEvent(new CustomEvent(SOURCES_EVENT, { detail: target }));
}

export function addSource(target: string, ref: SourceRef): SourceRef[] {
  const next = [...read(target).filter((s) => s.id !== ref.id), { ...ref, excerpt: ref.excerpt ? ref.excerpt.slice(0, MAX_EXCERPT) : null }].slice(-MAX_SOURCES);
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
    window.addEventListener(SOURCES_EVENT, sync);
    return () => window.removeEventListener(SOURCES_EVENT, sync);
  }, [target]);
  return sources;
}

const KIND_LABEL: Record<SourceKind, string> = { code: "Code", review: "Review", test: "Test", forge: "CI" };

/**
 * Der Block, der beim Absenden an den Prompt tritt — dieselbe Form, die die
 * Vorschau zeigt. Nummeriert, mit Typ, damit der Agent Zitate sauber
 * referenzieren kann; hart auf `MAX_BLOCK` gekappt (K5: Payload ≤ 4 KB gesamt).
 */
export function sourcesBlock(sources: SourceRef[]): string {
  if (sources.length === 0) return "";
  const lines: string[] = ["<quellen>"];
  for (const [i, s] of sources.slice(0, MAX_SOURCES).entries()) {
    const excerpt = s.excerpt ? `\n«${s.excerpt.slice(0, MAX_EXCERPT)}»` : "";
    lines.push(`[${i + 1}] ${KIND_LABEL[s.kind]} — ${s.label}${excerpt}`);
  }
  lines.push("</quellen>");
  const block = lines.join("\n");
  return block.length > MAX_BLOCK ? `${block.slice(0, MAX_BLOCK - 12)}\n</quellen>` : block;
}
