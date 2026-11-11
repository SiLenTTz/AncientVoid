import { beforeEach, describe, expect, it } from "vitest";

const mem = new Map<string, string>();
const props = new Map<string, string>();
const dataset: Record<string, string> = {};
const events: string[] = [];

Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => mem.get(key) ?? null,
    setItem: (key: string, value: string) => void mem.set(key, value),
    removeItem: (key: string) => void mem.delete(key),
  },
});
const root = {
  dataset,
  style: {
    setProperty: (k: string, v: string) => void props.set(k, v),
    removeProperty: (k: string) => void props.delete(k),
  },
};
Object.defineProperty(globalThis, "document", { configurable: true, value: { documentElement: root } });
Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: { dispatchEvent: (e: Event) => events.push(e.type), addEventListener: () => {}, removeEventListener: () => {} },
});

const a = await import("../../src/app/appearance.ts");

beforeEach(() => {
  mem.clear();
  props.clear();
  events.length = 0;
  for (const key of Object.keys(dataset)) delete dataset[key];
});

describe("Hex und Farbräume (EPIC-P34 T34.4/T34.5)", () => {
  it("normalizeHex nimmt #rgb, rgb, #RRGGBB und lehnt den Rest ab", () => {
    expect(a.normalizeHex("#F90")).toBe("#ff9900");
    expect(a.normalizeHex("ff9a3c")).toBe("#ff9a3c");
    expect(a.normalizeHex("  #FF9A3C ")).toBe("#ff9a3c");
    for (const bad of ["", "#12", "#12345", "#gggggg", "rgb(1,2,3)", "#1234567", "ff9a3cff"]) expect(a.normalizeHex(bad), bad).toBeNull();
  });

  it("Hex → HSV → Hex ist verlustfrei, auch für Grau, Schwarz und Weiß", () => {
    for (const hex of ["#000000", "#ffffff", "#808080", "#ff9a3c", "#d9601a", "#123456", "#fedcba", "#00ff00", "#0000ff", "#010203"]) {
      expect(a.hsvToHex(a.hexToHsv(hex)), hex).toBe(hex);
    }
    // Zufallsstichprobe mit festem Startwert: kein Kanal darf beim Rundlauf wandern.
    let seed = 7;
    const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648);
    for (let i = 0; i < 500; i++) {
      const hex = `#${(next() % 0x1000000).toString(16).padStart(6, "0")}`;
      expect(a.hsvToHex(a.hexToHsv(hex)), hex).toBe(hex);
    }
  });

  it("HSV bleibt in seinen Grenzen; ein Wert außerhalb wird geklemmt", () => {
    expect(a.hsvToHex({ h: 0, s: 100, v: 100 })).toBe("#ff0000");
    expect(a.hsvToHex({ h: 360, s: 100, v: 100 })).toBe("#ff0000");
    expect(a.hsvToHex({ h: 120, s: 150, v: 200 })).toBe("#00ff00");
    expect(a.hsvToHex({ h: -240, s: -5, v: 50 })).toBe("#808080");
  });
});

describe("Kontrast und Warnungen (AC-P34-4)", () => {
  it("contrastRatio folgt WCAG: Schwarz/Weiß 21, gleiche Farbe 1", () => {
    expect(a.contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(a.contrastRatio("#336699", "#336699")).toBeCloseTo(1, 5);
  });

  it("der Text auf der Akzentfläche erreicht für JEDE Farbe mindestens 4,5:1", () => {
    let worst = Infinity;
    for (let r = 0; r < 256; r += 15) for (let g = 0; g < 256; g += 15) for (let b = 0; b < 256; b += 15) {
      const hex = a.rgbToHex({ r, g, b });
      worst = Math.min(worst, a.contrastRatio(a.accentInk(hex), hex));
    }
    expect(worst).toBeGreaterThanOrEqual(4.5);
  });

  it("die Standard-Akzente lösen keine Warnung aus", () => {
    expect(a.accentWarnings(a.DEFAULT_ACCENT.dark, "dark")).toEqual([]);
    expect(a.accentWarnings(a.DEFAULT_ACCENT.light, "light")).toEqual([]);
  });

  it("zu wenig Kontrast zum Hintergrund und Nähe zu einer Statusfarbe werden benannt, nicht verboten", () => {
    expect(a.accentWarnings("#15161a", "dark").join(" ")).toMatch(/Kontrast/);
    expect(a.accentWarnings("#fefefe", "light").join(" ")).toMatch(/Kontrast/);
    expect(a.accentWarnings("#4fe0a9", "dark").join(" ")).toMatch(/läuft/);
    expect(a.accentWarnings("#ff5c6c", "dark").join(" ")).toMatch(/Fehler/);
  });
});

describe("Zustand lesen und schreiben (fail loud: kaputt ergibt Standard)", () => {
  it("ohne Eintrag gilt der Standard", () => {
    expect(a.getAppearance()).toEqual(a.DEFAULT_APPEARANCE);
  });

  it("kaputtes JSON, falsche Typen und unbekannte Schriften fallen feldweise auf den Standard zurück", () => {
    expect(a.parseAppearance("{nope")).toEqual(a.DEFAULT_APPEARANCE);
    expect(a.parseAppearance("[]")).toEqual(a.DEFAULT_APPEARANCE);
    const parsed = a.parseAppearance(JSON.stringify({ accent: { dark: "rot", light: "#D9601A" }, fontUi: "comic-sans", fontCode: "inter", fontScale: "groß" }));
    expect(parsed.accent).toEqual({ dark: null, light: "#d9601a" });
    expect(parsed.fontUi).toBe(a.DEFAULT_APPEARANCE.fontUi);
    // Code und Diff brauchen eine Festbreitenschrift: Inter ist dort nicht erlaubt.
    expect(parsed.fontCode).toBe(a.DEFAULT_APPEARANCE.fontCode);
    expect(parsed.fontScale).toBe(1);
  });

  it("die Schriftgröße rastet auf 5-%-Schritte ein und bleibt zwischen 85 und 130 %", () => {
    expect(a.clampFontScale(1.02)).toBe(1);
    expect(a.clampFontScale(1.1 + 0.05)).toBe(1.15);
    expect(a.clampFontScale(0.1)).toBe(0.85);
    expect(a.clampFontScale(9)).toBe(1.3);
    expect(a.clampFontScale(Number.NaN)).toBe(1);
  });

  it("setAppearance speichert, wendet an und meldet es; der Standard räumt den Eintrag ab", () => {
    const next = { ...a.DEFAULT_APPEARANCE, accent: { dark: "#33aaff", light: null }, fontScale: 1.15 };
    a.setAppearance(next);
    expect(JSON.parse(mem.get("ancientvoid.appearance")!)).toMatchObject({ accent: { dark: "#33aaff" }, fontScale: 1.15 });
    expect(events).toContain("ancientvoid:appearance");
    expect(a.getAppearance()).toEqual(next);
    a.setAppearance(a.DEFAULT_APPEARANCE);
    expect(mem.has("ancientvoid.appearance")).toBe(false);
  });
});

describe("Anwenden auf das Dokument", () => {
  it("setzt Akzent samt Schriftfarbe NUR für das aktive Theme und räumt sonst ab", () => {
    const set = { ...a.DEFAULT_APPEARANCE, accent: { dark: "#33aaff", light: "#aa3300" } };
    a.applyAppearance(set, "dark", root);
    expect(props.get("--accent")).toBe("#33aaff");
    expect(props.get("--accent-ink")).toBe("#000000");
    a.applyAppearance(set, "light", root);
    expect(props.get("--accent")).toBe("#aa3300");
    expect(props.get("--accent-ink")).toBe("#ffffff");
    a.applyAppearance({ ...set, accent: { dark: "#33aaff", light: null } }, "light", root);
    expect(props.has("--accent")).toBe(false);
    expect(props.has("--accent-ink")).toBe(false);
  });

  it("Schrift und Größe landen als Variablen; im Standard bleibt das Stylesheet zuständig", () => {
    a.applyAppearance({ ...a.DEFAULT_APPEARANCE, fontUi: "atkinson", fontCode: "system-mono", fontScale: 1.2 }, "dark", root);
    expect(props.get("--font-ui")).toContain("Atkinson");
    expect(props.get("--font-code")).toContain("ui-monospace");
    expect(props.get("--font-scale")).toBe("1.2");
    a.applyAppearance(a.DEFAULT_APPEARANCE, "dark", root);
    expect([...props.keys()]).toEqual([]);
  });
});

describe("EPIC-P43 T43.1: neue Standards, Bestandsschutz der gespeicherten Wahl (AC-P43-4)", () => {
  it("Standard ist Inter und Void-Violett; ohne Eintrag schreibt appearance.ts nichts aufs Dokument", () => {
    expect(a.DEFAULT_APPEARANCE.fontUi).toBe("inter");
    expect(a.DEFAULT_ACCENT).toEqual({ dark: "#b58cff", light: "#6a3cc9" });
    a.applyAppearance(a.getAppearance(), "dark", root);
    expect([...props.keys()]).toEqual([]);
  });

  it("eine vor dem Update gespeicherte Wahl überlebt: Akzent, JetBrains Mono als Oberflächenschrift, Größe", () => {
    // So lag der Eintrag vor P43 im Speicher, wenn jemand nur den Akzent geändert hatte.
    mem.set("ancientvoid.appearance", JSON.stringify({ accent: { dark: "#ff9a3c", light: null }, fontUi: "jetbrains-mono", fontCode: "jetbrains-mono", fontScale: 1.1 }));
    const kept = a.getAppearance();
    expect(kept).toEqual({ accent: { dark: "#ff9a3c", light: null }, fontUi: "jetbrains-mono", fontCode: "jetbrains-mono", fontScale: 1.1 });
    a.applyAppearance(kept, "dark", root);
    expect(props.get("--accent")).toBe("#ff9a3c");
    expect(props.get("--font-ui")).toContain("JetBrains Mono");
    expect(props.get("--font-scale")).toBe("1.1");
    // Im hellen Erscheinungsbild war nichts gewählt: dort gilt der neue Standard des Stylesheets.
    a.applyAppearance(kept, "light", root);
    expect(props.has("--accent")).toBe(false);
  });

  it("wer JetBrains Mono nach dem Update wählt, behält es über einen Neustart", () => {
    a.setAppearance({ ...a.DEFAULT_APPEARANCE, fontUi: "jetbrains-mono" });
    expect(a.getAppearance().fontUi).toBe("jetbrains-mono");
  });

  it("der Farbwähler warnt bei Nähe zur Ruf-Farbe, in beiden Erscheinungsbildern", () => {
    expect(a.accentWarnings("#ff9a3c", "dark").join(" ")).toMatch(/du bist dran/);
    expect(a.accentWarnings("#fd9c40", "dark").join(" ")).toMatch(/du bist dran/);
    expect(a.accentWarnings(a.CALL_COLOR.light, "light").join(" ")).toMatch(/du bist dran/);
    expect(a.accentWarnings("#b58cff", "dark")).toEqual([]);
  });
});
