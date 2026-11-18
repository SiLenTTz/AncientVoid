import { beforeEach, describe, expect, it } from "vitest";
import {
  MAX_REPLAY_KEEP,
  dropRecording,
  getRecording,
  listRecordings,
  saveRecording,
} from "../../../src/shared/stt-replay.ts";
import { replacementPlan } from "../../../src/features/stt/paste-target.ts";

/**
 * ADR-0092: die Rohaufnahme eines Diktats bleibt auf dem Geraet, damit sie neu
 * erkannt werden kann — nach einem Ausfall der eigenen Erkennung ebenso wie nach
 * einem verhorten Fachwort. Diese Unit haelt die Grenzen der Ablage fest
 * (wenige Stuecke, kleiner Deckel, spurlos entfernbar) und die Ersetzungsregel
 * („nur was unveraendert dasteht, wird ersetzt“).
 */
const stueck = (text: string) => new Blob([text.repeat(4)], { type: "audio/webm" });
const engpass = { budgetBytes: 60 };

beforeEach(async () => {
  for (const aufnahme of await listRecordings()) await dropRecording(aufnahme.id);
});

describe("Replay-Ablage (ADR-0092)", () => {
  it("merkt die drei neuesten Aufnahmen — neueste zuerst, die älteste fliegt zuerst", async () => {
    for (let durchgang = 1; durchgang <= MAX_REPLAY_KEEP + 1; durchgang += 1) {
      await saveRecording({ blob: stueck(`d${durchgang}`), mime: "audio/webm", seconds: durchgang, engine: "whisper-e2e", ...engpass });
      if (durchgang < MAX_REPLAY_KEEP + 1) await new Promise((r) => setTimeout(r, 5));
    }
    const liste = await listRecordings();
    expect(liste).toHaveLength(MAX_REPLAY_KEEP);
    expect(liste.map((aufnahme) => aufnahme.seconds)).toEqual([4, 3, 2]);
    const vierte = liste[0]!;
    expect(vierte.engine).toBe("whisper-e2e");
    expect(vierte.failed).toBe(false);
  });

  it("eine Aufnahme wegwerfen — ohne Rest in der Liste", async () => {
    const vorher = (await listRecordings()).length;
    const rein = await saveRecording({ blob: stueck("weg"), mime: "audio/webm", seconds: 7, engine: "whisper-e2e", ...engpass });
    expect(rein.id).toBeTruthy();
    expect((await listRecordings()).length).toBe(Math.min(vorher + 1, MAX_REPLAY_KEEP));
    await dropRecording(rein.id);
    expect((await listRecordings()).some((aufnahme) => aufnahme.id === rein.id)).toBe(false);
    expect(await getRecording(rein.id)).toBeUndefined();
  });

  it("ein Stueck ueber dem Deckel wird nicht gemerkt — die anderen bleiben heil", async () => {
    const gut = await saveRecording({ blob: new Blob(["x".repeat(24)], { type: "audio/webm" }), mime: "audio/webm", seconds: 3, engine: "whisper-e2e", ...engpass });
    const uebergross = await saveRecording({ blob: new Blob(["y".repeat(400)], { type: "audio/webm" }), mime: "audio/webm", seconds: 90, engine: "whisper-e2e", ...engpass });
    expect(uebergross.ignored).toBe(true);
    const liste = await listRecordings();
    expect(liste.some((aufnahme) => aufnahme.id === gut.id)).toBe(true);
    expect(liste.some((aufnahme) => aufnahme.id === uebergross.id)).toBe(false);
  });

  it("auch ein fehlgeschlagener Durchlauf bleibt liegen — mit Grund und ohne Text", async () => {
    const fehl = await saveRecording({
      blob: stueck("kaputt"),
      mime: "audio/webm",
      seconds: 11,
      failed: true,
      reason: "eigene Spracherkennung nicht erreichbar",
      ...engpass,
    });
    const liste = await listRecordings();
    const gemerkt = liste.find((aufnahme) => aufnahme.id === fehl.id);
    expect(gemerkt?.failed).toBe(true);
    expect(gemerkt?.text).toBe("");
    expect(gemerkt?.reason).toBe("eigene Spracherkennung nicht erreichbar");
    const voll = await getRecording(fehl.id);
    expect(voll?.blob.size).toBeGreaterThan(0);
  });
});

describe("replacementPlan — ersetzen, aber keine Handarbeit überschreiben", () => {
  it("ersetzt den alten Text, solange er unveraendert im Feld steht", () => {
    const plan = replacementPlan("Starte die Tests im Worktree", "Starte die Tests im Worktree", "Starte die Tests — mit Protokoll");
    expect(plan.mode).toBe("replace");
    expect(plan.value).toBe("Starte die Tests — mit Protokoll");
  });

  it("laesst ein von Hand geaendertes Feld in Ruhe und haengt an", () => {
    const feld = "Starte die Tests im Worktree, bitte leise";
    const plan = replacementPlan(feld, "Starte die Tests im Worktree", "Starte die Tests — mit Protokoll");
    expect(plan.mode).toBe("append");
    expect(plan.value.startsWith(feld)).toBe(true);
    expect(plan.value).toContain("Starte die Tests — mit Protokoll");
  });

  it("ohne alten Text (Ausfall-Durchlauf) wird einfach eingefuegt", () => {
    const plan = replacementPlan("", "", "Doch, jetzt klar");
    expect(plan.mode).toBe("append");
    expect(plan.value).toBe("Doch, jetzt klar");
  });

  it("ein Teil des alten Textes darf nicht ueberschrieben werden", () => {
    const plan = replacementPlan("Vorher: Starte die Tests im Worktree. Nachher: nichts.", "Starte die Tests im Worktree", "Neu erkannt");
    expect(plan.mode).toBe("append");
    expect(plan.value).toContain("Vorher:");
  });
});
