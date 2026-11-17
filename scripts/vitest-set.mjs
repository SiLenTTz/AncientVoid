#!/usr/bin/env node
/**
 * Setzt `VITEST_SET` und startet Vitest — ohne Shell-Trick.
 *
 * Die Inline-Schreibweise `VITEST_SET=fast vitest run` ist POSIX-Syntax. npm führt Scripts
 * auf Windows über `cmd.exe` aus, und die kennt das nicht: Der schnelle Loop (`test:fast`)
 * und der Langsam-Tier (`test:slow`) waren auf Windows schlicht unbenutzbar —
 * `Der Befehl "VITEST_SET" ist entweder falsch geschrieben oder konnte nicht gefunden
 * werden`. Für einen Windows-Rechner (Kais Desk) heißt das: der vorgesehene Arbeits-Loop
 * existierte dort nicht, alle Welt lief mit nacktem `npx vitest run` und verlor damit die
 * Tier-Aufteilung. BUG-0193.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const [tier, ...rest] = process.argv.slice(2);
if (!tier) {
  console.error("Gebrauch: node scripts/vitest-set.mjs <fast|slow> [vitest-Argumente…]");
  process.exit(2);
}

const cli = join(process.cwd(), "node_modules", "vitest", "vitest.mjs");
if (!existsSync(cli)) {
  console.error(`Vitest-Einstieg nicht gefunden: ${cli} — erst npm install`);
  process.exit(1);
}

const res = spawnSync(process.execPath, [cli, "run", ...rest], {
  stdio: "inherit",
  env: { ...process.env, VITEST_SET: tier },
});
if (res.error) console.error(String(res.error.message ?? res.error));
process.exit(res.status ?? 1);
