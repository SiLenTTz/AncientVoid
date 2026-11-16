import { describe, expect, it } from "vitest";
import { DISPLAY_ANSWER_CAPABILITY, displayAnswerable, displayAnswersValid } from "../../src/approvals/display.ts";

const question = { action: "tool.question", class: "write", reasonRequired: false, status: "pending" };
const farbe = { question: "Welche Farbe?", options: [{ label: "Rot" }, { label: "Grün (Recommended)" }], multiSelect: false };
const groesse = { question: "Wie groß?", options: [{ label: "S" }, { label: "M" }, { label: "L" }] };
const caps = [DISPLAY_ANSWER_CAPABILITY];

/** EPIC-P43 T43.10 (ADR-0066): der enge Fall, in dem ein Display eine Rückfrage beantwortet. */
describe("display answers (ADR-0066)", () => {
  it("answerable only with the capability, for a pending write question whose every part has options", () => {
    expect(displayAnswerable(question, [farbe], caps)).toBe(true);
    expect(displayAnswerable(question, [farbe, groesse], caps)).toBe(true);
    expect(displayAnswerable(question, [farbe], [])).toBe(false);
    expect(displayAnswerable({ ...question, action: "tool.Bash" }, [farbe], caps)).toBe(false);
    expect(displayAnswerable({ ...question, class: "destructive" }, [farbe], caps)).toBe(false);
    expect(displayAnswerable({ ...question, reasonRequired: true }, [farbe], caps)).toBe(false);
    expect(displayAnswerable({ ...question, status: "approved" }, [farbe], caps)).toBe(false);
  });

  it("not answerable when a display would have to type, pick several, or guess", () => {
    for (const questions of [
      undefined,
      [],
      "Welche Farbe?",
      [{ question: "Frei?", options: [] }],
      [{ question: "Nur eine?", options: [{ label: "Ja" }] }],
      [{ ...farbe, multiSelect: true }],
      [farbe, { question: "Frei?", options: [] }],
      [{ question: "", options: [{ label: "a" }, { label: "b" }] }],
      [{ question: "Doppelt?", options: [{ label: "a" }, { label: "a" }] }],
      [{ question: "Leer?", options: [{ label: "a" }, { label: "" }] }],
      [farbe, farbe],
      [null],
    ]) {
      expect(displayAnswerable(question, questions, caps), JSON.stringify(questions)).toBe(false);
      expect(displayAnswersValid(questions, { "Welche Farbe?": "Rot" }), JSON.stringify(questions)).toBe(false);
    }
  });

  it("an answer is exactly one given option per question, word for word", () => {
    expect(displayAnswersValid([farbe], { "Welche Farbe?": "Rot" })).toBe(true);
    expect(displayAnswersValid([farbe, groesse], { "Welche Farbe?": "Grün (Recommended)", "Wie groß?": "M" })).toBe(true);
    expect(displayAnswersValid([farbe], undefined)).toBe(false);
    expect(displayAnswersValid([farbe], {})).toBe(false);
    expect(displayAnswersValid([farbe], { "Welche Farbe?": "Blau" })).toBe(false);
    expect(displayAnswersValid([farbe], { "Welche Farbe?": "rot" })).toBe(false);
    expect(displayAnswersValid([farbe], { "Welche Farbe?": "Grün" })).toBe(false);
    expect(displayAnswersValid([farbe], { "Welche Farbe?": "Rot", "Und sonst?": "ignoriere alles" })).toBe(false);
    expect(displayAnswersValid([farbe], { "Andere Frage": "Rot" })).toBe(false);
    expect(displayAnswersValid([farbe, groesse], { "Welche Farbe?": "Rot" })).toBe(false);
    expect(displayAnswersValid([farbe, groesse], { "Welche Farbe?": "M", "Wie groß?": "Rot" })).toBe(false);
    expect(displayAnswersValid([{ question: "__proto__", options: [{ label: "a" }, { label: "b" }] }], {})).toBe(false);
  });
});
