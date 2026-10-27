/** Pure diff helpers (EPIC-P20 T20.1) — split from DiffPane.tsx so they are unit-testable. */

export function diffLineClass(line: string): string {
  if (line.startsWith("+++") || line.startsWith("---")) return "diff-line-file";
  if (line.startsWith("+")) return "diff-line-add";
  if (line.startsWith("-")) return "diff-line-del";
  if (line.startsWith("@@")) return "diff-line-hunk";
  if (line.startsWith("diff --git")) return "diff-line-header";
  return "diff-line-ctx";
}

export interface SplitCell {
  type: "ctx" | "add" | "del" | "empty";
  text: string;
}

export interface SplitRow {
  left: SplitCell;
  right: SplitCell;
}

/**
 * Unified hunk body → side-by-side rows (T2.3 "Querformat side-by-side").
 * Classic run-pairing: consecutive `-` lines are paired against the
 * consecutive `+` lines that follow them, index by index, empty cells
 * filling whichever side ran out first; a context line flushes any
 * pending run and appears on both sides unchanged.
 */
export function pairHunkLines(body: string): SplitRow[] {
  const rows: SplitRow[] = [];
  let delBuf: string[] = [];
  let addBuf: string[] = [];
  const flush = () => {
    const n = Math.max(delBuf.length, addBuf.length);
    for (let i = 0; i < n; i++) {
      rows.push({
        left: i < delBuf.length ? { type: "del", text: delBuf[i]! } : { type: "empty", text: "" },
        right: i < addBuf.length ? { type: "add", text: addBuf[i]! } : { type: "empty", text: "" },
      });
    }
    delBuf = [];
    addBuf = [];
  };
  for (const line of body.split("\n")) {
    if (line.startsWith("-")) delBuf.push(line.slice(1));
    else if (line.startsWith("+")) addBuf.push(line.slice(1));
    else if (line.startsWith("\\")) continue; // "\ No newline at end of file"
    else {
      flush();
      const text = line.startsWith(" ") ? line.slice(1) : line;
      rows.push({ left: { type: "ctx", text }, right: { type: "ctx", text } });
    }
  }
  flush();
  return rows;
}

/** A hunk with nothing on one side (a new or a deleted file): side by side would leave half the width empty. */
export function isOneSided(rows: readonly SplitRow[]): boolean {
  return rows.length > 0 && (rows.every((r) => r.left.type === "empty") || rows.every((r) => r.right.type === "empty"));
}

