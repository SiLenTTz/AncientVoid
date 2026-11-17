import { beforeEach, describe, expect, it } from "vitest";
import {
  createSoundPlayer,
  loadSoundSettings,
  saveSoundSettings,
  SOUND_OPTIONS,
  volumeGain,
  RATE_LIMIT_MS,
  defaultSoundSettings,
  type SoundPlayer,
} from "../../src/shared/audio.ts";

/** EPIC-P65 T65.1: WebAudio-Spieler mit injizierter Attrappe (K2/K10-Disziplin:
 * deterministisch testbar, kein Lautsprecher, kein Netz). */

interface FakeCtx {
  state: string;
  currentTime: number;
  destination: object;
  resumes: number;
  oscStarts: number;
  gains: number[];
  resume(): Promise<void>;
  createOscillator(): {
    type: string;
    frequency: { value: number };
    connect: (dest: object) => void;
    start: (when: number) => void;
    stop: (when: number) => void;
  };
  createGain: () => { gain: { value: number }; connect: (dest: object) => void };
}

function fakeCtx(): FakeCtx {
  return {
    state: "suspended",
    currentTime: 0,
    destination: {},
    resumes: 0,
    oscStarts: 0,
    gains: [],
    async resume() {
      this.resumes += 1;
      this.state = "running";
    },
    createOscillator() {
      const self = this;
      return {
        type: "sine",
        frequency: { value: 0 },
        connect: () => undefined,
        start: () => {
          self.oscStarts += 1;
        },
        stop: () => undefined,
      };
    },
    createGain() {
      const self = this;
      const gain = {
        value: 0,
        setValueAtTime: (v: number) => {
          gain.value = v;
          self.gains.push(v);
        },
        linearRampToValueAtTime: () => undefined,
        exponentialRampToValueAtTime: () => undefined,
      };
      return { gain, connect: () => undefined };
    },
  };
}

function stubStorage() {
  const store = new Map<string, string>();
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
}

let ctx: FakeCtx;
let now: number;
let vibrations: number[];
let player: SoundPlayer;

beforeEach(() => {
  stubStorage();
  ctx = fakeCtx();
  now = 1_000_000;
  vibrations = [];
  player = createSoundPlayer({
    audioContext: () => ctx,
    now: () => now,
    vibrate: (ms) => vibrations.push(ms),
  });
});

describe("Varianten-Registry (AC-P65-2)", () => {
  it("jede Kategorie hat mindestens drei Varianten mit eindeutigen IDs", () => {
    for (const options of Object.values(SOUND_OPTIONS)) {
      expect(options.length).toBeGreaterThanOrEqual(3);
      expect(new Set(options.map((o) => o.id)).size).toBe(options.length);
    }
  });

  it("die Default-Varianten jeder Kategorie sind in der Registry", () => {
    const settings = defaultSoundSettings();
    for (const [cat, row] of Object.entries(settings.categories)) {
      expect(SOUND_OPTIONS[cat as keyof typeof SOUND_OPTIONS].some((o) => o.id === row.variant), cat).toBe(true);
    }
  });
});

describe("Spieler: Unlock, Master, Kategorien (AC-P65-1/2)", () => {
  it("vor der Entsperrung wird nichts gespielt — danach schon (Unlock-Reihenfolge)", () => {
    expect(player.playCategory("error")).toBe(false);
    expect(ctx.oscStarts).toBe(0);
    player.unlock();
    expect(player.playCategory("error")).toBe(true);
    expect(ctx.oscStarts).toBeGreaterThan(0);
  });

  it("Master aus → nichts, auch bei aktivierter Kategorie", () => {
    player.unlock();
    saveSoundSettings({ ...defaultSoundSettings(), master: false });
    expect(player.playCategory("error")).toBe(false);
    expect(ctx.oscStarts).toBe(0);
  });

  it("info ist standardmäßig aus; einschalten lässt es klingen", () => {
    player.unlock();
    expect(player.playCategory("info")).toBe(false);
    saveSoundSettings({ ...defaultSoundSettings(), categories: { ...defaultSoundSettings().categories, info: { enabled: true, variant: "ping", volume: 1 } } });
    expect(player.playCategory("info")).toBe(true);
    expect(ctx.oscStarts).toBeGreaterThan(0);
  });

  it("Vibration bei error/action, nicht bei done — und kein Fehler ohne API (AC-P65-5)", () => {
    player.unlock();
    player.playCategory("error");
    expect(vibrations.length).toBe(1);
    player.playCategory("action");
    expect(vibrations.length).toBe(2);
    now += RATE_LIMIT_MS;
    player.playCategory("done");
    expect(vibrations.length).toBe(2);
    const stumm = createSoundPlayer({ audioContext: () => ctx, now: () => now, vibrate: undefined });
    stumm.unlock();
    now += RATE_LIMIT_MS;
    expect(() => stumm.playCategory("error")).not.toThrow();
  });
});

describe("Rate-Limit (AC-P65-3)", () => {
  it("zwölf Meldungen einer Kategorie in zehn Sekunden → genau ein Sound", () => {
    player.unlock();
    let played = 0;
    for (let i = 0; i < 12; i++) {
      now += 300;
      if (player.playCategory("error")) played += 1;
    }
    expect(played).toBe(1);
  });

  it("andere Kategorien werden nicht begrenzt; nach dem Fenster spielt die erste wieder", () => {
    player.unlock();
    expect(player.playCategory("error")).toBe(true);
    expect(player.playCategory("action")).toBe(true);
    expect(player.playCategory("done")).toBe(true);
    expect(player.playCategory("error")).toBe(false);
    now += RATE_LIMIT_MS;
    expect(player.playCategory("error")).toBe(true);
  });
});

describe("Lautstärke und Vorschau", () => {
  it("volumeGain skaliert 0–1 auf den Synthese-Pegel", () => {
    expect(volumeGain(1)).toBeCloseTo(0.25);
    expect(volumeGain(0)).toBe(0);
    expect(volumeGain(2)).toBeCloseTo(0.25);
  });

  it("die gewählte Variante bestimmt die Notenzahl (Hüllkurven werden gebaut)", () => {
    player.unlock();
    player.preview("done", "trill"); // vier Töne
    expect(ctx.oscStarts).toBe(4);
  });

  it("Vorschau entsperrt den Context ohne vorherige Interaktion (AC-P65-2)", () => {
    expect(player.preview("action", "bell")).toBe(true);
    expect(ctx.resumes).toBeGreaterThan(0);
    expect(ctx.oscStarts).toBeGreaterThan(0);
  });
});

describe("Persistenz ancientvoid.sounds (AC-P65-2)", () => {
  it("Speichern und Laden sind ein Rundtrip; leerer Speicher liefert die Defaults", () => {
    expect(loadSoundSettings()).toEqual(defaultSoundSettings());
    const next = { ...defaultSoundSettings(), master: false } as ReturnType<typeof defaultSoundSettings>;
    next.categories.error = { enabled: true, variant: "horn", volume: 0.5 };
    saveSoundSettings(next);
    expect(loadSoundSettings()).toEqual(next);
  });

  it("kaputter Speicher und unbekannte Varianten werfen nicht — Defaults bleiben", () => {
    localStorage.setItem("ancientvoid.sounds", "{kein json");
    expect(loadSoundSettings()).toEqual(defaultSoundSettings());
    localStorage.setItem("ancientvoid.sounds", JSON.stringify({ master: true, categories: { error: { enabled: true, variant: "unknown", volume: 9 } } }));
    expect(loadSoundSettings().categories.error.variant).toBe("gong");
  });

  it("unbekannte Event-Quelle ohne Fenster: Spieler wirft bei play nicht", () => {
    const stumm = createSoundPlayer({ audioContext: () => null, events: null, vibrate: undefined });
    stumm.unlock();
    expect(stumm.playCategory("error")).toBe(false);
  });

  it("Injektion: EventTarget als Geste entsperrt wie im Browser", async () => {
    const target = new EventTarget();
    const ziel = createSoundPlayer({ audioContext: () => ctx, now: () => now, events: target, vibrate: undefined });
    expect(ziel.preview("info", "blip")).toBe(true); // Vorschau darf immer
    const vorher = ctx.oscStarts;
    target.dispatchEvent(new Event("pointerdown"));
    // Nach der Geste spielt der Spieler über den normalen Pfad (Context läuft).
    now += RATE_LIMIT_MS;
    expect(ziel.playCategory("done")).toBe(true);
    expect(ctx.oscStarts).toBeGreaterThan(vorher);
  });
});
