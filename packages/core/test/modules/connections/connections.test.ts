import { describe, expect, it } from "vitest";
import { EndpointEntryInput, VoidWardenConnectionInput } from "@ancientvoid/contracts";
import { ConnectionStore, HubDatabase, SettingsStore, probeEndpoint } from "../../../src/index.ts";

const vw = (over: Record<string, unknown> = {}) => VoidWardenConnectionInput.parse({ name: "Nyx Board", ...over });
const ep = (over: Record<string, unknown> = {}) => EndpointEntryInput.parse({ name: "Gpubox", kind: "llm", baseUrl: "http://100.64.0.10:8100/v1", models: ["halogen-qwen"], ...over });

describe("ConnectionStore: VoidWarden-Verbindungen", () => {
  const make = () => {
    const settings = new SettingsStore(new HubDatabase(":memory:"));
    return { settings, store: new ConnectionStore(settings) };
  };

  it("legt an, ändert, löscht — und überlebt einen Neustart (config-Tabelle, K7)", () => {
    const { settings, store } = make();
    const a = store.addVoidWarden(vw(), "agent:vw-aaaaaaaa");
    const b = store.addVoidWarden(vw({ name: "Kiosk Handy", endpoint: "http://pixel:8080" }), "agent:vw-bbbbbbbb");
    expect(store.listVoidWarden().map((e) => e.name)).toEqual(["Nyx Board", "Kiosk Handy"]);

    // Neustart: gleiche Persistenz, neuer Store.
    const reopened = new ConnectionStore(settings);
    expect(reopened.listVoidWarden()).toHaveLength(2);
    expect(reopened.listVoidWarden()[1]).toMatchObject({ name: "Kiosk Handy", endpoint: "http://pixel:8080", tokenLabel: "agent:vw-bbbbbbbb" });

    expect(reopened.updateVoidWarden(a.id, vw({ name: "Nyx neu" }), "agent:vw-cccccccc")?.tokenLabel).toBe("agent:vw-cccccccc");
    expect(reopened.updateVoidWarden("00000000-0000-4000-8000-000000000000", vw())).toBeNull();
    expect(reopened.removeVoidWarden(b.id)?.tokenLabel).toBe("agent:vw-bbbbbbbb");
    expect(reopened.removeVoidWarden(b.id)).toBeNull();
    expect(reopened.listVoidWarden()).toHaveLength(1);
  });
});

describe("ConnectionStore: Endpoints", () => {
  const make = () => {
    const settings = new SettingsStore(new HubDatabase(":memory:"));
    return { settings, store: new ConnectionStore(settings) };
  };

  it("speichert den API-Schlüssel nur als Hash — Klartext erscheint nie in der Konfiguration", () => {
    const { settings, store } = make();
    const entry = store.addEndpoint(ep({ apiKey: "sk-streng-geheim-1234" }));
    expect(entry.apiKeyHash).toMatch(/^[0-9a-f]{64}$/);
    const persisted = settings.get("connections.endpoints") ?? "";
    expect(persisted).not.toContain("sk-streng-geheim-1234");
    expect(JSON.parse(persisted)[0].apiKeyHash).toBe(entry.apiKeyHash);
  });

  it("beim Bearbeiten: Schlüssel weglassen behält, null entfernt, String ersetzt", () => {
    const { store } = make();
    const entry = store.addEndpoint(ep({ apiKey: "sk-erster-schlüssel-987" }));
    const hash = entry.apiKeyHash;

    expect(store.updateEndpoint(entry.id, ep())?.apiKeyHash).toBe(hash);
    expect(store.updateEndpoint(entry.id, ep({ apiKey: null }))?.apiKeyHash).toBeNull();
    const replaced = store.updateEndpoint(entry.id, ep({ apiKey: "sk-zweiter-schluessel" }));
    expect(replaced?.apiKeyHash).toMatch(/^[0-9a-f]{64}$/);
    expect(replaced?.apiKeyHash).not.toBe(hash);
    expect(store.updateEndpoint("00000000-0000-4000-8000-000000000000", ep())).toBeNull();
  });

  it("dedupliziert Modelle und hält den letzten Probe besorgt", () => {
    const { store } = make();
    const entry = store.addEndpoint(ep({ models: ["a", "a", "b"] }));
    expect(entry.models).toEqual(["a", "b"]);
    const probe = { at: "2026-11-11T10:00:00.000Z", ok: true, httpStatus: 401, detail: null };
    expect(store.recordProbe(entry.id, probe)?.probe).toEqual(probe);
    expect(store.removeEndpoint(entry.id)).toBe(true);
    expect(store.removeEndpoint(entry.id)).toBe(false);
  });
});

describe("probeEndpoint", () => {
  const res = (status: number): Response => new Response(null, { status });

  it("jede HTTP-Antwort ist Erreichbarkeit — auch 401/403 beweisen nur, dass der Endpoint da ist", async () => {
    expect(await probeEndpoint("http://da/v1", async () => res(401))).toMatchObject({ ok: true, httpStatus: 401 });
    expect(await probeEndpoint("http://da/v1", async () => res(503))).toMatchObject({ ok: true, httpStatus: 503 });
  });

  it("Netzwerkfehler und Timeout sind nicht erreichbar; das Detail nennt den Kode, nie Schlüssel oder Query", async () => {
    const refused = async () => {
      throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
    };
    expect(await probeEndpoint("http://127.0.0.1:1/v1", refused)).toMatchObject({ ok: false, httpStatus: null, detail: "ECONNREFUSED" });

    const timeout = async () => {
      throw new DOMException("signal timed out", "TimeoutError");
    };
    expect(await probeEndpoint("http://langsam/v1", timeout)).toMatchObject({ ok: false, detail: "Zeitüberschreitung (5 s)" });
  });
});
