/**
 * BUG-0169/BUG-0179 (Windows): Node darf `.cmd`-Shims (`npm`, `npx`) nicht ohne Shell
 * spawnen — ohne `shell` gibt es EINVAL/ENOENT, und der betreffende Gate-Lauf ist auf
 * Windows schlicht nicht ausführbar. Die Argumente dieser Aufrufe sind feste Konstanten
 * (kein Nutzereingang), deshalb ist `shell: true` an diesen Stellen vertretbar; Node
 * warnt sonst vor DEP0190.
 */
export const winShell = process.platform === "win32";
