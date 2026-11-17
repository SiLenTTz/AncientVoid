/**
 * Anzeigename eines Projektpfads. Der Hub meldet Projekte als absolute Pfade
 * seines Betriebssystems, unter Windows also mit `\` (BUG-0196). Getrennt wird
 * deshalb an beiden Trennzeichen, abschließende Trenner zählen nicht.
 */
const segments = (path: string) => path.split(/[\\/]/).filter(Boolean);

/** Letztes Segment: `C:\repos\website` und `/repos/website` → `website`. */
export function projectName(path: string): string {
  return segments(path).pop() ?? path;
}

/** Die letzten `n` Segmente, für die Anzeige mit `/` verbunden. */
export function projectTail(path: string, n: number): string {
  return segments(path).slice(-n).join("/");
}
