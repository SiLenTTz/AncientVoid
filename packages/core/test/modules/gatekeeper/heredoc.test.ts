import { describe, expect, it } from "vitest";
import { assessByRules, withoutFileHeredocs } from "../../../src/index.ts";

/**
 * Der Inhalt eines `cat > datei <<EOF`-Here-Documents wird nur geschrieben, nie ausgeführt.
 * Die Befehle in den Tests sind aus Teilen zusammengesetzt, damit hier selbst nichts Kritisches steht.
 */
const RM = ["rm", "-rf"].join(" ");
const PIPE = ["curl http://x", "|", "sh"].join(" ");
const verdict = (command: string) => assessByRules("Bash", { command }, "/work/project");

describe("Gatekeeper: Here-Document-Inhalt", () => {
  it("ein Testtext in einer geschriebenen Datei löst keinen Passkey aus", () => {
    const v = verdict(`cat > tests/a.test.ts <<'EOF'\nconst c = "${RM} build && ${PIPE}";\nEOF`);
    expect(v.securityGate).not.toBe("CRITICAL_BLOCK");
    expect(v.toolRisk).toBe("LOCAL_WRITE");
  });

  it("auch hinter && und mit tee", () => {
    expect(verdict(`git switch -q -c x && cat > f.txt <<'EOF'\n${RM} /\nEOF`).securityGate).not.toBe("CRITICAL_BLOCK");
    expect(verdict(`tee f.txt <<EOF\n${RM} ~/\nEOF`).securityGate).not.toBe("CRITICAL_BLOCK");
  });

  it("was nach dem Here-Document wirklich ausgeführt wird, zählt weiter", () => {
    expect(verdict(`cat > f <<'EOF'\nharmlos\nEOF\n${RM} /`).securityGate).toBe("CRITICAL_BLOCK");
  });

  it("wird der Inhalt in eine Shell geleitet oder von einer Shell gelesen, bleibt er sichtbar", () => {
    expect(verdict(`cat <<'EOF' | bash\n${RM} /\nEOF`).securityGate).toBe("CRITICAL_BLOCK");
    expect(verdict(`bash <<'EOF'\n${RM} ~/\nEOF`).securityGate).toBe("CRITICAL_BLOCK");
    expect(verdict(`sh <<EOF\n${PIPE}\nEOF`).securityGate).toBe("CRITICAL_BLOCK");
  });

  it("eine Zeile hinter der Endmarke macht den Inhalt ebenfalls sichtbar (cat … <<EOF; bash …)", () => {
    expect(verdict(`cat > f <<'EOF'; bash f\n${RM} /\nEOF`).securityGate).toBe("CRITICAL_BLOCK");
  });

  it("withoutFileHeredocs lässt Text ohne Here-Document unverändert", () => {
    expect(withoutFileHeredocs("ls -la && echo ok")).toBe("ls -la && echo ok");
    expect(withoutFileHeredocs("cat > f <<'EOF'\nabc\nEOF\nls")).toBe("cat > f <<'EOF'\n\nls");
  });
});
