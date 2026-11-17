import { join } from "node:path";

/**
 * Pfad zu einer Attrappen-CLI in `e2e/support/bin/`.
 *
 * BUG-0179: diese Attrappen sind Shebang-Skripte **ohne Endung**. Auf Windows konnte
 * CreateProcess damit nichts anfangen (`spawn ENOENT`), und die Suite zahlte das tagelang
 * mit `read ECONNRESET`. Behoben wird das an der einzigen richtigen Stelle — beim Starten:
 * `spawnArgv` in contracts stellt auf Windows das Node-Programm vor den Skriptpfad.
 *
 * Der erste Weg über `.cmd`-Wrapper plus Shell ist verworfen: die Shell-Schicht zerlegt
 * Stdio-Pipes und Exit-Semantik. Gemessen 2026-11-17: `codex/app-server.test.ts` lief 180 s
 * (13 × 15 s Timeout), weil die JSON-RPC-Antwort nicht zurückkam.
 */
const binDir = join(import.meta.dirname, "bin");

export function standIn(name: string): string {
  return join(binDir, name);
}
