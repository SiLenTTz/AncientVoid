/**
 * Ein Startbefehl für eine konfigurierte Provider-CLI, plattformgerecht in argv übersetzt.
 *
 * BUG-0179: die E2E-Attrappen in `e2e/support/bin/` sind Shebang-Skripte **ohne Endung**.
 * Unter Windows kann CreateProcess damit nichts anfangen (`spawn ENOENT`), und die Suite
 * zahlte das wochenlang mit `read ECONNRESET`.
 *
 * Der erste Versuch — `.cmd`-Wrapper plus `shell: true` — ist eine messbare Sackgasse: die
 * Shell-Schicht legt `cmd.exe` zwischen Hub und Attrappe, und damit sind Stdio-Pipes und
 * Exit-Semantik kaputt. Gemessen 2026-11-17: `codex/app-server.test.ts` verbringt 180 s mit
 * 13 × 15 s Timeout, weil die JSON-RPC-Antwort den Weg zurück nicht findet. Also kein
 * Shell-Layer: auf Windows bekommt ein Skriptpfad das Node-Programm vorangestellt.
 *
 * Bewusst ohne `node:fs`: contracts wird auch von der PWA (Browser-Bundel) importiert. Die
 * Einordnung gelingt deshalb ohne Dateisystem — ein Pfad mit Trenner ist ein Skript, ein
 * karger Name (`git`) wird vom PATH aufgelöst und bleibt unverändert.
 */
export interface SpawnArgv {
  file: string;
  args: string[];
  shell?: boolean;
}

const EXE_ENDUNG = /\.(exe|com)$/i;
const SKRIPT_ENDUNG = /\.(mjs|cjs|js|ts)$/i;
const SHELL_ENDUNG = /\.(cmd|bat)$/i;
const TRENNER = /[\\/]/;

/** Rein und testbar: die Einordnung hängt nur an Plattform, Pfadform und Endung. */
export function classifyArgv(cmd: string, args: readonly string[], platform: string, execPath?: string): SpawnArgv {
  const rest = [...args];
  if (platform !== "win32") return { file: cmd, args: rest };
  if (EXE_ENDUNG.test(cmd)) return { file: cmd, args: rest };
  if (SHELL_ENDUNG.test(cmd)) return { file: cmd, args: rest, shell: true };
  const interpreter = execPath ?? (globalThis as { process?: { execPath?: string } }).process?.execPath;
  // Ein Pfad (mit Trenner) ohne ausführbare Endung ist ein Skript — auf Windows nur über
  // Node startbar. Karge Namen ohne Trenner überlässt man dem PATH.
  if (interpreter && (SKRIPT_ENDUNG.test(cmd) || (!EXE_ENDUNG.test(cmd) && TRENNER.test(cmd)))) {
    return { file: interpreter, args: [cmd, ...rest] };
  }
  return { file: cmd, args: rest };
}

export function spawnArgv(cmd: string, args: readonly string[] = []): SpawnArgv {
  const proc = (globalThis as { process?: { platform?: string; execPath?: string } }).process;
  return classifyArgv(cmd, args, proc?.platform ?? "", proc?.execPath);
}
