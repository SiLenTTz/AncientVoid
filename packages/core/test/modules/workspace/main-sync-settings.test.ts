import { describe, expect, it } from "vitest";
import { MAIN_SYNC_DEFAULTS } from "@ancientvoid/contracts";
import { HubDatabase, MainSyncSettingsService } from "../../../src/index.ts";
import { SettingsStore } from "../../../src/modules/attachments/store.ts";

function mkService(): { service: MainSyncSettingsService; kv: Map<string, string> } {
  const kv = new Map<string, string>();
  const service = new MainSyncSettingsService({
    get: (k) => kv.get(k) ?? null,
    set: (k, v) => (v === null ? kv.delete(k) : kv.set(k, v)),
  });
  return { service, kv };
}

describe("EPIC-P67 T67.3: MainSyncSettingsService (config-Tabelle, K7)", () => {
  it("leerer Speicher: globale Defaults, fallback 'missing'; keine Overrides", () => {
    const { service } = mkService();
    expect(service.global()).toEqual({ value: MAIN_SYNC_DEFAULTS, fallback: "missing" });
    expect(service.overrides()).toEqual({ value: {}, fallback: "missing" });
  });

  it("setGlobal/global: Roundtrip über den KV-Speicher", () => {
    const { service } = mkService();
    const changed = { ...MAIN_SYNC_DEFAULTS, checkIntervalMin: 30, behindAction: "ask" as const };
    service.setGlobal(changed);
    expect(service.global()).toEqual({ value: changed, fallback: "none" });
  });

  it("AC-P67-8 — K7-Recovery: eine NEUE Instanz über demselben Speicher liest dieselben Werte", () => {
    const { service, kv } = mkService();
    const changed = { ...MAIN_SYNC_DEFAULTS, fetchTimeoutSec: 30 };
    service.setGlobal(changed);
    service.setOverrides({ "/projekte/alpha": { startSync: "off" } });
    const reopened = new MainSyncSettingsService({
      get: (k) => kv.get(k) ?? null,
      set: (k, v) => (v === null ? kv.delete(k) : kv.set(k, v)),
    });
    expect(reopened.global()).toEqual({ value: changed, fallback: "none" });
    expect(reopened.overrides()).toEqual({ value: { "/projekte/alpha": { startSync: "off" } }, fallback: "none" });
  });

  it("korrupter globaler Eintrag: Defaults + fallback 'invalid' (laut, nicht still)", () => {
    const { service, kv } = mkService();
    kv.set("mainSync.global", "{kein json");
    expect(service.global()).toEqual({ value: MAIN_SYNC_DEFAULTS, fallback: "invalid" });
  });

  it("korrupter Override-Eintrag: leere Map + 'invalid'; unbekannte Felder entfallen einzeln", () => {
    const { service, kv } = mkService();
    kv.set("mainSync.projects", "[]");
    expect(service.overrides()).toEqual({ value: {}, fallback: "invalid" });
    kv.set("mainSync.projects", JSON.stringify({ "/p": { startSync: "off", future: 1 }, "/q": { checkIntervalMin: 3 } }));
    expect(service.overrides()).toEqual({ value: { "/p": { startSync: "off" } }, fallback: "invalid" });
  });

  it("effective(): Defaults ← global ← Projekt-Patch", () => {
    const { service } = mkService();
    service.setGlobal({ ...MAIN_SYNC_DEFAULTS, checkIntervalMin: 30, behindAction: "ask" });
    service.setOverrides({ "/alpha": { checkIntervalMin: 0 }, "/beta": {} });
    expect(service.effective("/alpha").checkIntervalMin).toBe(0);
    expect(service.effective("/alpha").behindAction).toBe("ask");
    expect(service.effective("/beta").checkIntervalMin).toBe(30);
    expect(service.effective("/unbekannt").checkIntervalMin).toBe(30);
  });

  it("resolver() liefert effektive Einstellungen je Projektpfad (Anschluss SessionManager, T67.2)", () => {
    const { service } = mkService();
    service.setOverrides({ "/alpha": { startSync: "off" } });
    const resolve = service.resolver();
    expect(resolve("/alpha").startSync).toBe("off");
    expect(resolve("/other").startSync).toBe("fetch-base");
  });

  it("setOverrides lehnt ungültige Patches laut ab und leere Patches entfallen", () => {
    const { service } = mkService();
    expect(() => service.setOverrides({ "/p": { checkIntervalMin: 3 } })).toThrow();
    service.setOverrides({ "/leer": {} });
    expect(service.overrides()).toEqual({ value: {}, fallback: "none" });
  });

  it("auf dem echten SettingsStore (config-Tabelle, HubDatabase): gleiche Ergebnisse", () => {
    const db = new HubDatabase(":memory:");
    const settings = new SettingsStore(db);
    const service = new MainSyncSettingsService(settings);
    service.setGlobal({ ...MAIN_SYNC_DEFAULTS, fetchTimeoutSec: 20 });
    service.setOverrides({ "/tmp/proj": { defaultBranch: "release" } });
    const reopened = new MainSyncSettingsService(new SettingsStore(db));
    expect(reopened.global().value.fetchTimeoutSec).toBe(20);
    expect(reopened.effective("/tmp/proj").defaultBranch).toBe("release");
    expect(reopened.effective("/tmp/proj").fetchTimeoutSec).toBe(20);
  });
});
