#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { parseArgs } from "node:util";
import { atspiRole, Companion, detectBackend, HyprlandBackend, HyprlandInput, SwayBackend, WtypeInput } from "./companion.ts";
import { sendControl, serveControl } from "./control.ts";

/**
 * EPIC-P11 (ADR-0031):
 *   uacc-companion run --hub http://127.0.0.1:7373 --token-file ~/.config/uacc/companion.token [--allow foot,code] [--backend auto|hyprland|sway]
 *   uacc-companion stop | resume | status
 * The token comes from `hubctl token issue companion:<pc-name>`.
 */
const [cmd, ...rest] = process.argv.slice(2);
if (cmd === "stop" || cmd === "resume" || cmd === "status") {
  sendControl(cmd)
    .then((s) => console.log(s))
    .catch(() => {
      console.error("Companion läuft nicht (kein Steuer-Socket).");
      process.exit(1);
    });
} else if (cmd === "run") {
  const { values } = parseArgs({
    args: rest,
    options: {
      hub: { type: "string", default: "http://127.0.0.1:7373" },
      "token-file": { type: "string", default: `${homedir()}/.config/uacc/companion.token` },
      allow: { type: "string" },
      backend: { type: "string", default: "auto" },
      "no-atspi": { type: "boolean", default: false },
    },
  });
  const token = readFileSync(values["token-file"]!.replace(/^~(?=\/)/, homedir()), "utf8").split("\n")[0]!.trim();
  const focus = values.backend === "hyprland" ? new HyprlandBackend() : values.backend === "sway" ? new SwayBackend() : detectBackend();
  if (!focus) {
    console.error("Kein unterstützter Compositor erkannt (Hyprland oder sway).");
    process.exit(2);
  }
  const companion = new Companion({
    hub: values.hub!,
    token,
    focus,
    input: focus.name === "hyprland" ? new HyprlandInput() : new WtypeInput(),
    ...(values.allow ? { allow: values.allow.split(",").map((a) => a.trim()).filter(Boolean) } : {}),
    ...(values["no-atspi"] ? {} : { focusedRole: atspiRole() }),
    log: (m) => console.log(new Date().toISOString(), m),
  });
  const control = serveControl(companion);
  const end = () => {
    companion.shutdown();
    control.close();
  };
  process.on("SIGINT", end);
  process.on("SIGTERM", end);
  console.log(`uacc-companion: ${focus.name} → ${values.hub} (Not-Stopp: uacc-companion stop)`);
  await companion.run();
  control.close();
  if (companion.exitReason) {
    console.error(companion.exitReason);
    process.exit(3);
  }
} else {
  console.error("usage: uacc-companion run [--hub URL] [--token-file F] [--allow app,app] [--backend auto|hyprland|sway] | stop | resume | status");
  process.exit(64);
}
