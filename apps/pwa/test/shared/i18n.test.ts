// Tier A. EPIC-P61 T61.2: t(), Plural, Fallback, Browsersprach-Match.
import { afterEach, describe, expect, it, vi } from "vitest";
import { t, resolveLanguage, matchBrowserLanguage, getLanguageSetting, setLanguageSetting, catalogKeys } from "../../src/shared/i18n/index.ts";
import { fmtDate, fmtNumber, fmtTime } from "../../src/shared/i18n/format.ts";
import { en } from "../../src/shared/i18n/en.ts";

function fakeStorage() {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("i18n (EPIC-P61)", () => {
  it("Interpolation: {name}-Plätze werden gefüllt", () => {
    fakeStorage();
    setLanguageSetting("en");
    expect(t("error.rate_limited.other", { n: 30 })).toBe("Too many requests — retry in {n} seconds.".replace("{n}", "30"));
    expect(t("error.rate_limited.other", { n: 30 })).toContain("30");
  });

  it("Plural über Intl.PluralRules: count=1 → .one, count=5 → .other", () => {
    fakeStorage();
    setLanguageSetting("de");
    expect(t("error.rate_limited", { count: 1, n: 1 })).toBe("Zu viele Anfragen — noch 1 Sekunde bis zum nächsten Versuch.");
    expect(t("error.rate_limited", { count: 5, n: 5 })).toBe("Zu viele Anfragen — noch 5 Sekunden bis zum nächsten Versuch.");
    setLanguageSetting("en");
    expect(t("error.rate_limited", { count: 1, n: 1 })).toBe("Too many requests — retry in 1 second.");
    expect(t("error.rate_limited", { count: 5, n: 5 })).toBe("Too many requests — retry in 5 seconds.");
  });

  it("fehlender Schlüssel: sichtbarer Fallback (Schlüssel selbst), nie leer", () => {
    fakeStorage();
    setLanguageSetting("en");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(t("es.gibt.dich.nicht")).toBe("es.gibt.dich.nicht");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("Browsersprach-Match: Präfix gegen die Sprachliste, ohne Treffer Englisch", () => {
    expect(matchBrowserLanguage("de-AT")).toBe("de");
    expect(matchBrowserLanguage("en-GB")).toBe("en");
    expect(matchBrowserLanguage("fr-FR")).toBe("en");
    expect(matchBrowserLanguage(undefined)).toBe("en");
  });

  it("resolveLanguage: manuelle Wahl schlägt Browsersprache; auto matcht", () => {
    expect(resolveLanguage("de", "en-US")).toBe("de");
    expect(resolveLanguage("auto", "de-DE")).toBe("de");
    expect(resolveLanguage("auto", "es")).toBe("en");
  });

  it("Geräte-Einstellung persistiert; ohne localStorage bleibt auto", () => {
    fakeStorage();
    setLanguageSetting("en");
    expect(getLanguageSetting()).toBe("en");
    setLanguageSetting("auto");
    expect(getLanguageSetting()).toBe("auto");
    vi.unstubAllGlobals();
    expect(getLanguageSetting()).toBe("auto");
  });

  it("Katalog-Parität: en deckt jede de-Kategorie ab (AC-P61-2, tsc-verstärkt)", () => {
    expect(Object.keys(en).sort()).toEqual(catalogKeys());
  });

  it("Formatierung folgt der Sprache (Intl)", () => {
    fakeStorage();
    const when = "2026-11-21T14:05:00.000Z";
    setLanguageSetting("de");
    const deDate = fmtDate(when);
    const deTime = fmtTime(when);
    setLanguageSetting("en");
    expect(fmtDate(when)).not.toBe(deDate);
    expect(fmtTime(when)).not.toBe(deTime);
    setLanguageSetting("de");
    expect(fmtNumber(1234.5)).toBe("1.234,5");
    setLanguageSetting("en");
    expect(fmtNumber(1234.5)).toBe("1,234.5");
  });
});
