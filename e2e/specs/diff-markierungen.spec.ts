import { test, expect, sessionTab } from "../support/fixtures.ts";
import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Wortweise +/- Markierung im Diff. Der Fall, den Kai nennt: es aendert sich eine Zahl,
 * und die Zeilen-Darstellung malt zwei komplette Zeilen rot/gruen. Erzeugt wird ein
 * geaenderte, versionierte Zeile (Paar) plus ein Fall, in dem nichts gemeinsam ist
 * (Zeile ersetzt) — dort darf die Wort-Technik NICHT greifen.
 */

const git = (workdir: string, ...args: string[]) => execFileSync("git", ["-C", workdir, ...args], { encoding: "utf8" });

test.describe("Wortweise Diff-Markierung", () => {
  test("Zahlenanderung zeigt + und - am Segment, Zeilenersatz laesst die Zeile stehen", async ({ app, hub }) => {
    const id = await hub.createSession({ adapter: "dummy" });
    await hub.until(async () => (await hub.events(id)).some((e) => e.payload.kind === "session.created"), "session.created");
    const workdir = String((await hub.events(id)).find((e) => e.payload.kind === "session.created")?.payload.workdir);
    expect(workdir).toBeTruthy();

    // Versionierter Stand: beide Dateien mit einer Zeile.
    await writeFile(join(workdir, "zahl.txt"), "Der Wert 1204 betraegt genau 3 Tage.\n");
    await writeFile(join(workdir, "ersatz.txt"), "alpha beta gamma delta epsilon zeta eta theta\n");
    git(workdir, "add", "zahl.txt", "ersatz.txt");
    git(workdir, "-c", "user.email=e2e@example.com", "-c", "user.name=e2e", "commit", "-m", "Ausgangstext");

    // Aenderung: einmal eine Zahl, einmal die ganze Zeile ohne Gemeinsames.
    await writeFile(join(workdir, "zahl.txt"), "Der Wert 1379 betraegt genau 4 Tage.\n");
    await writeFile(join(workdir, "ersatz.txt"), "omega xi pi rho sigma tau upsilon phi\n");

    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await sessionTab(app, "Diff");
    await expect(app.locator(".diff-file-row").filter({ hasText: "zahl.txt" })).toBeVisible();

    // Legende erklaert die Zeichen einmal pro Diff.
    await expect(app.locator(".diff-legend")).toBeVisible();

    const zahl = app.locator(".diff-line-del").filter({ hasText: "1204" }).first();
    await expect(zahl.locator(".wd-del")).toHaveCount(2);
    await expect(zahl.locator(".wd-del").filter({ hasText: "1204" })).toHaveCount(1);
    const neu = app.locator(".diff-line-add").filter({ hasText: "1379" }).first();
    await expect(neu.locator(".wd-add")).toHaveCount(2);
    await expect(neu.locator(".wd-add").filter({ hasText: "1379" })).toHaveCount(1);
    // Das +/−-Zeichen sitzt am Segment, nicht nur als Zeilen-Gutter.
    await expect(neu.locator(".wd-add .wd-mark").first()).toHaveText("+");
    await expect(zahl.locator(".wd-del .wd-mark").first()).toHaveText("−");

    // Ganzzelliger Austausch: keine Segment-Marker, die Zeile bleibt als Ganzes markiert.
    const ersetzt = app.locator(".diff-line-del").filter({ hasText: "alpha beta gamma" }).first();
    await expect(ersetzt).toBeVisible();
    await expect(ersetzt.locator(".wd-del")).toHaveCount(0);

    // Spaltenansicht (ab Rechnerbreite) traegt dieselbe Feinmarkierung.
    await expect(app.locator(".hunk-split-cell.del .wd-del").filter({ hasText: "1204" })).toHaveCount(1);
    await expect(app.locator(".hunk-split-cell.add .wd-add").filter({ hasText: "1379" })).toHaveCount(1);

    // Der Zeilen-Hintergrund tritt zurueck, wenn Segmente da sind — gemessen, nicht gefuehlt.
    const farben = await app.evaluate(() => {
      const tint = (sel: string) => {
        const el = document.querySelector<HTMLElement>(sel);
        return el ? getComputedStyle(el).backgroundColor : "keine Zeile";
      };
      return {
        markiert: tint(".diff-line-add.wd-line"),
        unmarkiert: tint(".diff-line-add:not(.wd-line)"),
        spalte: tint(".hunk-split-cell.add.wd-line"),
      };
    });
    console.log("ZEILENTINT " + JSON.stringify(farben));
    expect(farben.markiert).not.toBe(farben.unmarkiert);
    expect(farben.spalte).toBe(farben.markiert);

    // Beweisbild: der Diff rendert nach (Hub cache 5 s), also mehrfach scrollen und
    // pruefen, bis die Segmente wirklich im Bild sind.
    for (let versuch = 0; versuch < 4; versuch += 1) {
      await app.evaluate(() => document.querySelector(".diff-line-add .wd-add")?.scrollIntoView({ block: "center" }));
      await app.waitForTimeout(600);
      if (await app.locator(".diff-line-add .wd-add").first().isVisible()) break;
    }
    await app.screenshot({ path: "data/tmp-debug/diff-marken.png" });
  });

  test("Commit ueber der Groessenkante zeigt Teilbefund, andere Commits bleiben lesbar", async ({ app, hub }) => {
    const NL = String.fromCharCode(10);
    const id = await hub.createSession({ adapter: "dummy" });
    await hub.until(async () => (await hub.events(id)).some((e) => e.payload.kind === "session.created"), "session.created");
    const workdir = String((await hub.events(id)).find((e) => e.payload.kind === "session.created")?.payload.workdir);

    await writeFile(join(workdir, "klein.txt"), "alpha beta gamma" + NL);
    git(workdir, "add", "klein.txt");
    git(workdir, "commit", "-q", "-m", "kleiner Schnitt");
    const riesig = Array.from({ length: 4500 }, (_, i) => `zeile ${i}`).join(NL) + NL;
    await writeFile(join(workdir, "riesig.txt"), riesig);
    git(workdir, "add", "riesig.txt");
    git(workdir, "commit", "-q", "-m", "riesiger Schnitt");

    await app.goto(`${hub.origin}/#/sessions/${id}`);
    await sessionTab(app, "Diff");
    await expect(app.locator(".diff-commit-heading").filter({ hasText: "riesiger Schnitt" })).toBeVisible();

    // Der ubergrosse Commit sagt Zahl + Befund, statt den View zu loeschen.
    const hinweis = app
      .locator(".diff-commit-heading")
      .filter({ hasText: "riesiger Schnitt" })
      .locator(".diff-oversize");
    await expect(hinweis).toContainText("1 Datei, 4.500 geänderte Zeilen");

    // ...und der kleine Commit daneben bleibt vollstaendig lesbar.
    await expect(app.locator(".diff-line-add").filter({ hasText: "alpha beta gamma" }).first()).toBeVisible();
    await app.screenshot({ path: "data/tmp-debug/diff-oversize.png" });
  });
});
