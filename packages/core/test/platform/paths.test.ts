import { describe, it, expect } from "vitest";
import { outsideRoots } from "../../src/modules/discovery/text.ts";
import { pathWithin } from "../../src/platform/paths.ts";

/**
 * BUG-0165: der Wurzelvergleich verglich mit `${root}/` und warf damit auf
 * Windows jeden Pfad unterhalb einer Wurzel raus — der Nutzer ließ
 * `projectRoots` deshalb leer (und verlor die Allowlist). Getrennt nach
 * Pfadstil prüfbar, damit CI auf Linux den Windows-Zweig mitkriegt.
 */
describe("pathWithin (BUG-0165)", () => {
  it("schiebt Windows-Trennzeichen und Groß-/Kleinschreibung auf win32 korrekt", () => {
    expect(pathWithin("E:\\Coding\\projekt", "E:\\Coding", "win32")).toBe(true);
    expect(pathWithin("E:/Coding/projekt", "E:\\Coding", "win32")).toBe(true);
    expect(pathWithin("e:\\coding\\Projekt", "E:\\Coding", "win32")).toBe(true);
    expect(pathWithin("E:\\Coding", "E:\\Coding", "win32")).toBe(true);
    expect(pathWithin("E:\\CodingA", "E:\\Coding", "win32")).toBe(false);
    expect(pathWithin("D:\\Coding\\projekt", "E:\\Coding", "win32")).toBe(false);
    expect(pathWithin("E:\\Coding", "E:\\Coding\\projekt", "win32")).toBe(false);
  });

  it("bleibt auf posix trennzeichen- und groß/klein-kritisch", () => {
    expect(pathWithin("/root/projekt", "/root", "posix")).toBe(true);
    expect(pathWithin("/rootother", "/root", "posix")).toBe(false);
    expect(pathWithin("/Root/projekt", "/root", "posix")).toBe(false);
    // Auf POSIX ist der Backslash ein regulärer Dateizeichen, kein Trenner.
    expect(pathWithin("/root/a\\b", "/root/a", "posix")).toBe(false);
  });
});

describe("outsideRoots (BUG-0165)", () => {
  it("lässt Windows-Pfade unterhalb einer Wurzel durch (win32)", () => {
    expect(outsideRoots("E:\\Coding\\projekt", ["E:\\Coding"], "win32")).toBe(false);
    expect(outsideRoots("C:\\Users\\KaiFe\\Documents\\hardwareauswahl", ["C:\\Users\\KaiFe\\Documents"], "win32")).toBe(false);
    expect(outsideRoots("E:\\Anderes", ["E:\\Coding"], "win32")).toBe(true);
  });

  it("filtert auf posix weiterhin exakt", () => {
    expect(outsideRoots("/srv/projekt", ["/srv"], "posix")).toBe(false);
    expect(outsideRoots("/srv2/projekt", ["/srv"], "posix")).toBe(true);
  });

  it("leere Wurzeln lassen alles durch (unkonfiguriert wie vorher)", () => {
    expect(outsideRoots("E:\\Coding\\x", [], "win32")).toBe(false);
  });
});
