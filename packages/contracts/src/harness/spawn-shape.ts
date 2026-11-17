/**
 * Windows braucht für eine `.cmd`/`.bat`-Attrappe die Shell — CreateProcess kann Batch
 * nicht direkt, und Node wirft seit dem `.bat`/`.cmd`-Fix (CVE-2024-27980) ohne Shell
 * EINVAL. Echte Provider-CLIs (`.exe`, POSIX-Pfade) bleiben von der Regel unberührt.
 *
 * Hintergrund BUG-0179: die E2E-Attrappen in `e2e/support/bin/` sind Shebang-Skripte ohne
 * Endung. Auf Windows schlägt ihr Spawn fehl (`spawn ENOENT`), und die Suite zahlt das
 * später mit abgebrochenen Websocket-Verbindungen (`read ECONNRESET`) — teuer, weil es
 * wie ein Produktfehler aussieht. Darum: unter Windows `.cmd`-Wrapper verwenden und dort
 * spawnen, wo ein `.cmd` im Spiel ist, mit Shell.
 *
 * contracts ist auch im Browser unterwegs (die PWA importiert das Paket) — `process` gibt
 * es dort nicht, und der Typecheck des Pakets kennt keine Node-Typen. Deshalb der Weg über
 * `globalThis`, nicht über `process.platform` direkt.
 */
function platformOf(): string | undefined {
  const proc = (globalThis as { process?: { platform?: string } }).process;
  return typeof proc?.platform === "string" ? proc.platform : undefined;
}

export function shellFor(cmd: string): { shell?: boolean } {
  return platformOf() === "win32" && /\.(cmd|bat)$/i.test(cmd) ? { shell: true } : {};
}
