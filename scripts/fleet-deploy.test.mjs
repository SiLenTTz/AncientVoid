import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

describe("Dienstdatei des Hubs (BUG-0072)", () => {
  it("fleet-deploy.sh: ein Neustart oder Absturz des Hubs darf die Worker nicht mitnehmen", () => {
    const unit = read("scripts/fleet-deploy.sh");
    expect(unit).toMatch(/^KillMode=process$/m);
    expect(unit).toMatch(/^Restart=always$/m);
  });

  it("das Runbook zeigt dieselbe Dienstdatei", () => {
    const doc = read("docs/operations-runbook.md");
    expect(doc).toMatch(/^KillMode=process$/m);
    expect(doc).toMatch(/^Restart=always$/m);
  });
});

describe("Desktop-Starter (BUG-0073)", () => {
  const launcher = read("scripts/uacc-hub-app");

  it("startet über systemd, wenn die Dienstdatei da ist, statt einen zweiten Hub neben dem Dienst zu starten", () => {
    expect(launcher).toMatch(/systemctl --user start uacc-hub\.service/);
    expect(launcher).toMatch(/systemctl --user cat uacc-hub\.service/);
  });

  it("ein eigener Hub-Prozess nur als Rückfall ohne Dienstdatei", () => {
    const before = launcher.slice(0, launcher.indexOf("setsid"));
    expect(before).toMatch(/systemctl --user cat uacc-hub\.service/);
  });
});

describe("Heredoc der Dienstdatei", () => {
  it("enthält keine Backticks und kein $(…) außer dem Node-Pfad: im unquoted Heredoc würden sie ausgeführt", () => {
    const m = /cat > "\$HOME\/\.config\/systemd\/user\/uacc-hub\.service" <<UNIT\n([\s\S]*?)\nUNIT\n/.exec(read("scripts/fleet-deploy.sh"));
    expect(m).not.toBeNull();
    const body = m[1].replace("$(command -v node)", "").replaceAll("$host_id", "").replaceAll("$HOME", "");
    expect(body).not.toMatch(/`/);
    expect(body).not.toMatch(/\$\(/);
  });
});
