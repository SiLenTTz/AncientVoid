import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { epicStatusOf, listTree } from "../../../src/modules/code/explorer.ts";

/**
 * Nutzerauftrag 14.11.2026: Epic-Status im Dateibaum — Kategorie aus der
 * Statuszeile jeder EPIC-*.md. Die Testfälle sind echte Formulierungen aus
 * den Epic-Dateien des Repos (Stand 14.11.2026), damit die Heuristik an der
 * Realität hängt statt an erfundenen Mustern.
 */
const STATUS_LINES: [string, "done" | "code" | "wip" | "open"][] = [
  ["**Status:** abgeschlossen (05.11.2026, [MR !293], 1181 Tests / 295 E2E-Pässe, K8 grün)", "done"],
  ["**Status:** Planungsentwurf · **Umsetzung:** gesperrt (umpriorisiert 2026-11-08: läuft nach P36, Nutzerentscheid)", "open"],
  ["**Status:** in Umsetzung seit 2026-11-09 (P36 umgesetzt, Gating erfüllt)", "wip"],
  ["**Status:** umgesetzt 2026-11-10 (T40.1–T40.7, ADR-0064; Gate grün) — Live-Lauf mit echtem Hermes-Koordinator am Gerät offen", "code"],
  ["**Status:** Code abgeschlossen, Live-Abnahme offen", "code"],
  ["**Status:** teilweise umgesetzt (T51.1–T51.2: Vault-Unterbau; T51.3–T51.10 offen)", "code"],
  ["**Status:** offen · **Phase:** P47", "open"],
  ["**Status:** gebaut 2026-11-13 (T52.1–T52.7); echtes Handy und Bildzeit-p95 offen", "code"],
  ["**Status:** fertiggestellt 10.11.2026, Exit „No-go“ — Tailnet bleibt", "done"],
  ["**Status:** Code-Lücken der Übergabeprüfung geschlossen 11.11.2026, Exit offen", "code"],
  ["**Status:** Umsetzung (Branch `feat/p42-android-testgeraete`) · **Umsetzung:** freigegeben am 2026-11-11", "wip"],
];

describe("epicStatusOf (Nutzerauftrag 14.11.2026)", () => {
  it("kategorisiert die echten Statuszeilen der Epic-Dateien", () => {
    for (const [line, want] of STATUS_LINES) {
      const head = `# EPIC-Pn — Titel\n\n${line} · **Phase:** Pn\n`;
      const got = epicStatusOf(head);
      expect(got, line).not.toBeNull();
      expect(got!.epic, line).toBe(want);
      expect(got!.text.length, line).toBeGreaterThan(0);
    }
  });

  it("liefert null ohne Statuszeile und kürzt lange Zeilen ehrlich", () => {
    expect(epicStatusOf("# Nur eine Überschrift\n\nKein Status hier.")).toBeNull();
    const long = epicStatusOf(`**Status:** ${"sehr ".repeat(100)}lang`);
    expect(long!.text.length).toBeLessThanOrEqual(220);
  });
});

describe("listTree mit Epic-Anreicherung", () => {
  it("markiert EPIC-*.md der Seite mit Kategorie und Klartext, andere Dateien nicht", async () => {
    const root = mkdtempSync(join(tmpdir(), "av-epic-tree-"));
    mkdirSync(join(root, "epics"));
    writeFileSync(join(root, "epics", "EPIC-P99-fertig.md"), "# EPIC-P99\n\n**Status:** abgeschlossen (heute)\n");
    writeFileSync(join(root, "epics", "EPIC-P98-laufend.md"), "# EPIC-P98\n\n**Status:** in Umsetzung seit gestern\n");
    writeFileSync(join(root, "epics", "EPIC-P97-offen.md"), "# EPIC-P97\n\n**Status:** Planungsentwurf · **Umsetzung:** gesperrt\n");
    writeFileSync(join(root, "epics", "README.md"), "# Übersicht\n\n**Status:** nichts zählendes\n");
    writeFileSync(join(root, "EPIC-P96-ausserhalb.md"), "# Ohne epics-Ordner\n\n**Status:** abgeschlossen\n");
    const listing = (await listTree(root, "epics", { kind: "project", sessionId: null, root, branch: null, head: null, base: null }))!;
    const byName = new Map(listing.entries.map((e) => [e.name, e]));
    expect(byName.get("EPIC-P99-fertig.md")?.epic).toBe("done");
    expect(byName.get("EPIC-P99-fertig.md")?.epicStatus).toContain("abgeschlossen");
    expect(byName.get("EPIC-P98-laufend.md")?.epic).toBe("wip");
    expect(byName.get("EPIC-P97-offen.md")?.epic).toBe("open");
    expect(byName.get("README.md")?.epic).toBeNull();
    const top = (await listTree(root, "", { kind: "project", sessionId: null, root, branch: null, head: null, base: null }))!;
    expect(top.entries.find((e) => e.name === "EPIC-P96-ausserhalb.md")?.epic).toBe("done");
  });
});
