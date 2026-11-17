/**
 * Wortweise Diff-Markierung. Zeilen-Diffs sind bei kleinen Änderungen (eine Zahl, ein
 * Wort) unlesbar: zwei komplett rote/grüne Zeilen, dazwischen Suchen nach dem einen
 * Zeichen. Diese Helfer paarweisen Entferntes und Hinzugefügtes desselben Hunks und zerlegen sie in
 * gemeinsame und geänderte Segmente. Bewusst ohne neue Farben: die Segmente erben die
 * Zeilenfarbe, Markierung passiert über `+`/`−`, Durchstreichung und Unterlinie — also
 * auch ohne Farbtüchtigkeit unterscheidbar.
 */

export interface WordSeg {
  t: "eq" | "del" | "add";
  s: string;
}

/** Ein Paar aus Basis- und Neuer Zeile, segmentiert. */
export interface WordPair {
  left: WordSeg[];
  right: WordSeg[];
}

/** Ab hier lohnt LCS nicht mehr (Aufwand und Marker-Rauschen). */
const MAX_TOKENS = 160;
/** Mehr als so viele geänderte Segmente auf einer Zeile sind Rauschen, keine Information. */
const MAX_SEGMENTS = 6;

/** Wörter, Zahlen, Leerlauf und Einzelzeichen — so bleibt die Zeile verlustfrei zusammensetzbar. */
function tokenize(s: string): string[] {
  return s.match(/\s+|[0-9A-Za-zÄÖÜäöüß_]+|[^\s0-9A-Za-zÄÖÜäöüß_]/g) ?? [];
}

/** Gemeinsame Teilsequenz als Längen-Tabelle (kleine Zeilen, DP ist ausreichend). */
function lcsTable(a: string[], b: string[]): number[][] {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  return dp;
}

function segments(a: string[], b: string[]): { left: WordSeg[]; right: WordSeg[] } {
  const dp = lcsTable(a, b);
  const left: WordSeg[] = [];
  const right: WordSeg[] = [];
  const push = (list: WordSeg[], t: WordSeg["t"], s: string) => {
    const last = list[list.length - 1];
    if (last && last.t === t) last.s += s;
    else list.push({ t, s });
  };
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      push(left, "eq", a[i]);
      push(right, "eq", b[j]);
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      push(left, "del", a[i]);
      i += 1;
    } else {
      push(right, "add", b[j]);
      j += 1;
    }
  }
  while (i < a.length) push(left, "del", a[i++]);
  while (j < b.length) push(right, "add", b[j++]);
  return { left, right };
}

/**
 * Segmentpaar für eine geänderte Zeile, oder null wenn die Zeilen-Darstellung besser ist:
 * leer, zu lang, nichts gemeinsam (dann ist es ein Austausch, keine Feinarbeit), identisch
 * oder zu viele Segmente (Rauschen).
 */
export function wordDiff(delText: string, addText: string): WordPair | null {
  const a = tokenize(delText);
  const b = tokenize(addText);
  if (a.length === 0 || b.length === 0) return null;
  if (a.length > MAX_TOKENS || b.length > MAX_TOKENS) return null;
  if (a.join("") === b.join("")) return null;
  const dp = lcsTable(a, b);
  if (dp[0][0] === 0) return null;
  const { left, right } = segments(a, b);
  // Nur Leerzeichen gemeinsam zu haben erklaert nichts — das ist ein Austausch der Zeile.
  if (!left.some((s) => s.t === "eq" && s.s.trim() !== "")) return null;
  const geändert = Math.max(
    left.filter((s) => s.t === "del").length,
    right.filter((s) => s.t === "add").length,
  );
  if (geändert === 0 || geändert > MAX_SEGMENTS) return null;
  return { left, right };
}

/**
 * Ordnet den gemappten Hunk-Zeilen ihre Segmente zu: Index → Segmente der eigenen Zeile.
 * Gepatzt werden nur zusammenhängende Entfernungs- und Hinzufügungsblöcke gleicher Länge
 * (der Regelfall „eine Zeile geändert“).
 */
export function wordMarksFor(lines: { type: "ctx" | "add" | "del"; text: string }[]): (WordSeg[] | null)[] {
  const marks: (WordSeg[] | null)[] = lines.map(() => null);
  let i = 0;
  while (i < lines.length) {
    if (lines[i].type !== "del") {
      i += 1;
      continue;
    }
    let delEnd = i;
    while (delEnd < lines.length && lines[delEnd].type === "del") delEnd += 1;
    let addEnd = delEnd;
    while (addEnd < lines.length && lines[addEnd].type === "add") addEnd += 1;
    const nDel = delEnd - i;
    const nAdd = addEnd - delEnd;
    if (nDel === nAdd) {
      for (let k = 0; k < nDel; k += 1) {
        const pair = wordDiff(lines[i + k].text, lines[delEnd + k].text);
        if (!pair) continue;
        marks[i + k] = pair.left;
        marks[delEnd + k] = pair.right;
      }
    }
    i = addEnd > i ? addEnd : i + 1;
  }
  return marks;
}
