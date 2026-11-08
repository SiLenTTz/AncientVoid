import { describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REVIEW_NOTE_MAX_CHARS } from "@ancientvoid/contracts";
import { ReviewStore } from "../../../src/modules/reviews/review-store.ts";
import { composeFeedbackPrompt, composeFeedbackPackage, promptNeedsAttachment } from "../../../src/modules/reviews/prompt.ts";
import type { CreateReviewNoteInput, ReviewNote } from "@ancientvoid/contracts";

/** EPIC-P36 T36.2: Notizspeicher mit Journal/Snapshot-Recovery (K7) und Statusfaltung. */

let root: string;

function anchorInput(over: Partial<CreateReviewNoteInput> = {}): CreateReviewNoteInput {
  return {
    basis: {
      baseRef: "abc1230000000000000000000000000000000000",
      headSha: "def4560000000000000000000000000000000000",
      scope: { kind: "uncommitted" },
    },
    anchor: {
      path: "src/app.ts",
      side: "new",
      startLine: 10,
      endLine: 12,
      excerpt: "const answer = compute();",
    },
    text: "Bitte sprechende Variable nutzen.",
    ...over,
  };
}

async function withRoot(fn: () => Promise<void> | void): Promise<void> {
  root = await mkdtemp(join(tmpdir(), "av-reviews-"));
  try {
    await fn();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe("ReviewStore", () => {
  it("legt Notizen an, foldt Status und hält sie sortiert nach createdAt", async () => {
    await withRoot(() => {
      const store = new ReviewStore(root);
      const first = store.create("s1", anchorInput());
      const second = store.create("s1", anchorInput({ text: "Zweite Notiz" }));
      expect(first.status).toBe("draft");
      expect(store.list("s1").map((n) => n.text)).toEqual(["Bitte sprechende Variable nutzen.", "Zweite Notiz"]);
      store.setStatus("s1", second.id, "done");
      expect(store.get("s1", second.id)?.status).toBe("done");
    });
  });

  it("gleiche Datei/Zeile in zwei Commit-Abschnitten kollidiert nicht (AC-P36-1)", async () => {
    await withRoot(() => {
      const store = new ReviewStore(root);
      const shaA = "1111111111111111111111111111111111111111";
      const shaB = "2222222222222222222222222222222222222222";
      const a = store.create("s1", anchorInput({ basis: { baseRef: "base", headSha: null, scope: { kind: "commit", sha: shaA } } }));
      const b = store.create("s1", anchorInput({ basis: { baseRef: "base", headSha: null, scope: { kind: "commit", sha: shaB } } }));
      expect(a.id).not.toBe(b.id);
      expect(store.list("s1")).toHaveLength(2);
      // Löschen von a lässt b unberührt
      store.delete("s1", a.id);
      expect(store.list("s1").map((n) => n.id)).toEqual([b.id]);
    });
  });

  it("rekonstruiert den Zustand nach Simulated-Crash aus Journal+Snapshot (K7)", async () => {
    await withRoot(async () => {
      const store = new ReviewStore(root);
      const a = store.create("s1", anchorInput());
      store.create("s1", anchorInput({ text: "Noch eine" }));
      store.updateText("s1", a.id, "Geänderter Text");
      store.recordSend("s1", { operationId: "op-12345678", noteIds: [a.id], ok: true, detail: null });
      // Neuer Prozess: alles nur aus Dateien
      const reborn = new ReviewStore(root);
      const notes = reborn.list("s1");
      expect(notes).toHaveLength(2);
      const sent = reborn.get("s1", a.id);
      expect(sent?.status).toBe("sent");
      expect(sent?.text).toBe("Geänderter Text");
      expect(sent?.sentAt).toBeTruthy();
      expect(sent?.operationId).toBe("op-12345678");
      expect(reborn.recoveryReport("s1").skippedLines).toBe(0);
    });
  });

  it("erträgt Snapshot-Verlust: Rekonstruktion komplett aus dem Journal", async () => {
    await withRoot(async () => {
      const store = new ReviewStore(root);
      const a = store.create("s1", anchorInput());
      store.setStatus("s1", a.id, "open");
      await rm(join(root, "s1", "snapshot.json"));
      const reborn = new ReviewStore(root);
      expect(reborn.get("s1", a.id)?.status).toBe("open");
    });
  });

  it("zählt kaputte Journalzeilen sichtbar, statt sie zu verstecken", async () => {
    await withRoot(async () => {
      const store = new ReviewStore(root);
      store.create("s1", anchorInput());
      await writeFile(join(root, "s1", "notes.jsonl"), "{kaputtes json\n", { flag: "a" });
      const reborn = new ReviewStore(root);
      expect(reborn.list("s1")).toHaveLength(1);
      expect(reborn.recoveryReport("s1").skippedLines).toBe(1);
    });
  });

  it("fehlgeschlagener Versand behält Entwurf und Ursache (AC-P36-5)", async () => {
    await withRoot(() => {
      const store = new ReviewStore(root);
      const a = store.create("s1", anchorInput());
      store.recordSend("s1", { operationId: "op-87654321", noteIds: [a.id], ok: false, detail: "claude nimmt keine weiteren Eingaben an." });
      const note = store.get("s1", a.id);
      expect(note?.status).toBe("draft");
      expect(note?.sendDetail).toBe("claude nimmt keine weiteren Eingaben an.");
      expect(note?.sentAt).toBeNull();
    });
  });

  it("Notiztexte sind begrenzt — riesige Texte werden vorab abgelehnt", async () => {
    await withRoot(() => {
      const store = new ReviewStore(root);
      expect(() => store.create("s1", anchorInput({ text: "x".repeat(REVIEW_NOTE_MAX_CHARS + 1) }))).toThrow();
    });
  });
});

describe("composeFeedbackPrompt", () => {
  const note = (id: string, over: Partial<ReviewNote> = {}): ReviewNote => ({
    id,
    sessionId: "s1",
    basis: { baseRef: "base0000", headSha: "head0000", scope: { kind: "uncommitted" } },
    anchor: { path: "src/a.ts", side: "new", startLine: 3, endLine: 4, excerpt: "let x = 1" },
    text: `Text ${id}`,
    status: "draft",
    createdAt: "2026-11-08T00:00:00.000Z",
    updatedAt: "2026-11-08T00:00:00.000Z",
    sentAt: null,
    operationId: null,
    sendDetail: null,
    ...over,
  });

  it("ist deterministisch und nennt je Befund Datei, Zeilen und Bezug", () => {
    const p1 = composeFeedbackPrompt([note("a"), note("b", { basis: { baseRef: "b", headSha: null, scope: { kind: "commit", sha: "1234567890abcdef" } } })]);
    expect(p1).toContain("2 Befunden");
    expect(p1).toContain("1. [src/a.ts · neue Zeilen 3–4 · nicht committete Änderungen");
    expect(p1).toContain("Commit 1234567");
    expect(p1).toBe(composeFeedbackPrompt([note("a"), note("b", { basis: { baseRef: "b", headSha: null, scope: { kind: "commit", sha: "1234567890abcdef" } } })]));
  });

  it("schaltet auf Anhang um, wenn der Prompt die Inline-Schwelle sprengt", () => {
    const big = note("big", { text: "Fund ".repeat(2_000) });
    expect(promptNeedsAttachment([big])).toBe(true);
    expect(promptNeedsAttachment([note("small")])).toBe(false);
    expect(composeFeedbackPackage([note("a"), note("b")])).toContain("## Befund 1: src/a.ts");
  });
});
