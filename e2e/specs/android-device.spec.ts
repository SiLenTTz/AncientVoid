import { test, expect, openFromOverview, openLayer } from "../support/fixtures.ts";

/**
 * EPIC-P42 T42.6 (ADR-0067): Android-Testgeräte. Ohne SDK/KVM bleibt alles ehrlich sichtbar blockiert —
 * das ist der Normalfall auf CI und wird als Verhalten geprüft (Skip ≠ Pass). Die echte AVD-Abnahme
 * (AC-P42-1/2) läuft nur, wenn beides gesetzt ist:
 *   ANCIENTVOID_E2E_ANDROID=1 und hubOptions devices={sdkRoot, avdHome, avd}
 * Sie ist damit getrennt von P12/P16 Pixel-/Push-/Biometrie-Abnahmen (AC-P42-6).
 */

const full = process.env.ANCIENTVOID_E2E_ANDROID === "1";
if (full) test.use({ hubOptions: { devices: { sdkRoot: "/mnt/data/toolchain/android-sdk", avdHome: "/mnt/data/toolchain/av-avd", avd: "av-test" } } });

test.describe("Android-Testgeräte (EPIC-P42)", () => {
  test("Capabilities ehrlich: ohne SDK/KVM sichtbar blockiert, nie still grün", async ({ app, hub }) => {
    await hub.createSession({ adapter: "dummy" });
    await openFromOverview(app, "dummy");
    await openLayer(app, "Geräte");
    await expect(app.getByTestId("device-panel")).toBeVisible();
    const st = await hub.api<{ capabilities: { ready: boolean; reasons: string[]; kvm: { available: boolean } } }>("/api/devices");
    if (!st.body.capabilities.ready) {
      // Der Normalfall ohne SDK: der Grund steht in der Fläche und in der API — kein Fake-Grün.
      await expect(app.getByTestId("device-unavailable")).toBeVisible();
      await expect(app.getByTestId("device-unavailable")).toContainText(/SDK|KVM|adb|emulator/);
      const start = await hub.api("/api/devices/start", { body: { avd: "av-test" } });
      expect(start.status).toBe(503);
      expect(st.body.capabilities.reasons.length).toBeGreaterThan(0);
    } else {
      // SDK vorhanden: das Panel listet AVDs und bietet Start an — ohne env läuft hier keine echte Abnahme.
      await expect(app.getByTestId("device-avd")).toBeVisible();
      test.info().annotations.push({ type: "note", description: "SDK bereit, echte AVD-Abnahme nur mit ANCIENTVOID_E2E_ANDROID=1" });
    }
  });

  test("Physische Geräte bleiben sichtbar und werden nie gesteuert (AC-P42-3)", async ({ hub }) => {
    const st = await hub.api<{ devices: { serial: string; physical: boolean; owned: boolean }[] }>("/api/devices");
    const physical = st.body.devices.filter((d) => d.physical);
    for (const d of physical) {
      const stop = await hub.api("/api/devices/stop", { body: { serial: d.serial } });
      expect(stop.status, d.serial).toBe(403);
    }
    if (physical.length === 0) test.info().annotations.push({ type: "note", description: "kein physisches Gerät angesteckt — Regel über Unit-Tests belegt" });
  });

  test("Agent-Tokens bekommen alle Schreib-Routen 403 (Menschen-only)", async ({ hub }) => {
    const agent = hub.extraToken("agent:e2e");
    for (const [path, body] of [
      ["/api/devices/start", { avd: "av-test" }],
      ["/api/devices/stop", { serial: "emulator-5554" }],
      ["/api/devices/action", { serial: "emulator-5554", generation: 1, geometryVersion: 1, action: { type: "key", key: "back" } }],
    ] as const) {
      const res = await hub.apiRaw(path, { body, token: agent });
      expect(res.status, path).toBe(403);
    }
  });

  test(full ? "ECHTE ABNAHME: AVD starten, bedienen, PWA im Emulator-Chromium, beenden" : "echte AVD-Abnahme: ohne ANCIENTVOID_E2E_ANDROID=1 sichtbar übersprungen", async ({ hub }, testInfo) => {
    test.skip(!full, "Echte AVD-Abnahme braucht ANCIENTVOID_E2E_ANDROID=1 plus SDK/KVM (Skip ≠ Pass).");
    testInfo.setTimeout(420_000);
    const t0 = Date.now();

    // T42.2: AVD ausdrücklich ausgewählt starten — beobachtet bis ready.
    const start = await hub.api<{ serial: string }>("/api/devices/start", { body: { avd: "av-test" } });
    expect(start.status).toBe(202);
    const serial = start.body.serial;
    const st = () => hub.api<{ devices: { serial: string; owned: boolean; instance: { state: string } | null }[] }>("/api/devices");
    await expect.poll(async () => (await st()).body.devices.find((d) => d.serial === serial)?.instance?.state, { timeout: 300_000 }).toBe("ready");
    const tBoot = Date.now() - t0;

    // T42.3: Standbild-Pfad mit Geometrie-Metadaten (K1/K2-Nachweis).
    const frameStart = Date.now();
    await expect
      .poll(async () => (await hub.apiRaw(`/api/devices/${serial}/frame`)).status, { timeout: 30_000 })
      .toBe(200);
    const tFrame = Date.now() - frameStart;
    const frame = await hub.apiRaw(`/api/devices/${serial}/frame`);
    expect(frame.headers["content-type"]).toBe("image/png");
    expect(Number(frame.headers["x-frame-seq"])).toBeGreaterThan(0);
    expect(Number(frame.headers["x-frame-width"])).toBeGreaterThan(0);

    // Lease + gebundene Eingaben (Generation/Geometrie), Drift wird verweigert.
    const session = await hub.createSession({ adapter: "dummy" });
    const lease = await hub.api<{ generation: number }>("/api/devices/lease", { body: { serial, sessionId: session } });
    expect(lease.status).toBe(200);
    const generation = lease.body.generation;
    const home = await hub.api("/api/devices/action", { body: { serial, generation, geometryVersion: 1, action: { type: "key", key: "home" } } });
    expect(home.status).toBe(200);
    const rotate = await hub.api<{ geometryVersion: number }>("/api/devices/action", { body: { serial, generation, geometryVersion: 1, action: { type: "rotate", orientation: "landscape" } } });
    expect(rotate.status).toBe(200);
    const stale = await hub.api("/api/devices/action", { body: { serial, generation, geometryVersion: 1, action: { type: "tap", x: 100, y: 100 } } });
    expect(stale.status).toBe(409); // veraltetes Bild trifft nie den falschen Punkt (AC-P42-4)
    const backToPortrait = await hub.api<{ geometryVersion: number }>("/api/devices/action", { body: { serial, generation, geometryVersion: rotate.body.geometryVersion, action: { type: "rotate", orientation: "portrait" } } });
    expect(backToPortrait.status).toBe(200);
    const geo = backToPortrait.body.geometryVersion;

    // Begrenzte Logs/Tree.
    const logs = await hub.api<{ text: string }>(`/api/devices/${serial}/logs`);
    expect(typeof logs.body.text).toBe("string");
    const tree = await hub.apiRaw(`/api/devices/${serial}/tree`);
    expect(tree.headers["content-type"]).toBe("application/xml");

    // Testlauf hält die Lease selbst — die Menschen-Lease muss vorher frei sein (Konflikt → 409, nie Übernahme).
    expect((await hub.api("/api/devices/release", { body: { serial, generation } })).status).toBe(200);

    // T42.4 / AC-P42-2: PWA-Test im Emulator-Chromium mit Umgebungsnachweis.
    // Chromes First-Run-Dialog („Welcome to Chrome“) blockiert frische Emulatoren — per Baum-gesteuertem
    // Tap „Use without an account“/„Continue“ beenden, dann die URL erneut öffnen. Dafür bekommt die
    // Steuerung eine frische Generation; der Testlauf bekommt sie danach wieder frei.
    const freLease = await hub.api<{ generation: number }>("/api/devices/lease", { body: { serial, sessionId: session } });
    expect(freLease.status).toBe(200);
    const freGen = freLease.body.generation;
    const tapByText = async (needle: string): Promise<boolean> => {
      const raw = await hub.apiRaw(`/api/devices/${serial}/tree`);
      const xml = raw.body.toString("utf8");
      const m = new RegExp(`text="[^"]*${needle}[^"]*"[^>]*bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"`, "i").exec(xml);
      if (!m) return false;
      const x = Math.round((Number(m[1]) + Number(m[3])) / 2);
      const y = Math.round((Number(m[2]) + Number(m[4])) / 2);
      const tap = await hub.api("/api/devices/action", { body: { serial, generation: freGen, geometryVersion: geo, action: { type: "tap", x, y } } });
      return tap.status === 200;
    };
    await hub.api("/api/devices/action", { body: { serial, generation: freGen, geometryVersion: geo, action: { type: "openUrl", url: `http://10.0.2.2:${hub.port}/` } } });
    // Chromes First-Run hat mehrere Stufen (Sign-in, Benachrichtigungen, Ad-Privacy …) und ändert sich
    // zwischen Versionen — deshalb positiv aufs Ziel prüfen: solange „Verbinden“ (PWA-Login) nicht im
    // Baum steht, Known-Dismiss-Buttons tippen. Unbekannte Stufen fallen dadurch nicht mehr durch.
    const pwaLoginVisible = async (): Promise<boolean> => (await hub.apiRaw(`/api/devices/${serial}/tree`)).body.toString("utf8").includes("Verbinden");
    for (let i = 0; i < 8 && !(await pwaLoginVisible()); i++) {
      for (const needle of ["Use without an account", "No thanks", "Accept", "Continue"]) await tapByText(needle);
      await new Promise((r) => setTimeout(r, 1_500));
    }
    await hub.api("/api/devices/action", { body: { serial, generation: freGen, geometryVersion: geo, action: { type: "openUrl", url: `http://10.0.2.2:${hub.port}/` } } });
    expect((await hub.api("/api/devices/release", { body: { serial, generation: freGen } })).status).toBe(200);
    const run = await hub.api<{ id: string }>("/api/devices/tests", {
      body: { test: { name: "PWA-Anmeldung im Emulator-Chromium", serial, steps: [
        { type: "openUrl", url: `http://10.0.2.2:${hub.port}/`, timeoutMs: 15_000 },
        { type: "expectText", text: "Verbinden", timeoutMs: 15_000 },
      ] } },
    });
    expect(run.status).toBe(202);
    const runs = () => hub.api<{ runs: { id: string; state: string; env: { apiVersion: string | null; resolution: { width: number } | null } }[] }>(`/api/devices/tests?serial=${serial}`);
    await expect.poll(async () => (await runs()).body.runs.find((r) => r.id === run.body.id)?.state, { timeout: 120_000 }).toBe("passed");
    const done = (await runs()).body.runs.find((r) => r.id === run.body.id)!;
    expect(done.env.apiVersion).toBeTruthy(); // API/Build/Auflösung am Lauf festgehalten (AC-P42-2)
    expect(done.env.resolution?.width).toBeGreaterThan(0);

    // Beenden nur des eigenen Emulators; danach kein Frame mehr.
    const stop = await hub.api("/api/devices/stop", { body: { serial } });
    expect(stop.status).toBe(200);
    await expect.poll(async () => (await hub.apiRaw(`/api/devices/${serial}/frame`)).status, { timeout: 30_000 }).toBe(204);

    console.log(`P42-ABNAHME boot=${tBoot}ms frame-nach-ready=${tFrame}ms api=${done.env.apiVersion}`);
  });
});
