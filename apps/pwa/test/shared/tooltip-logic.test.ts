import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CLICK_SUPPRESS_MS, LONG_PRESS_MS, MOVE_TOLERANCE_PX, createLongPress, tipText } from "../../src/shared/tooltip-logic.ts";

describe("Long-Press (Touch-Tooltip)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const make = () => {
    const onLongPress = vi.fn();
    return { onLongPress, press: createLongPress({ onLongPress }) };
  };

  it("löst erst nach der Schwelle aus", () => {
    const { onLongPress, press } = make();
    press.start(10, 10);
    vi.advanceTimersByTime(LONG_PRESS_MS - 1);
    expect(onLongPress).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onLongPress).toHaveBeenCalledTimes(1);
  });

  it("ein kurzer Tap ist kein Long-Press und sein Click wird nicht unterdrückt", () => {
    const { onLongPress, press } = make();
    press.start(10, 10);
    vi.advanceTimersByTime(100);
    expect(press.end()).toBe(false);
    vi.advanceTimersByTime(LONG_PRESS_MS * 2);
    expect(onLongPress).not.toHaveBeenCalled();
    expect(press.shouldSuppressClick()).toBe(false);
  });

  it("der Click nach einem Long-Press wird genau einmal unterdrückt", () => {
    const { press } = make();
    press.start(10, 10);
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(press.end()).toBe(true);
    expect(press.shouldSuppressClick()).toBe(true);
    expect(press.shouldSuppressClick()).toBe(false);
  });

  it("der Click kommt schon vor dem Loslassen: auch dann unterdrückt", () => {
    const { press } = make();
    press.start(0, 0);
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(press.shouldSuppressClick()).toBe(true);
  });

  it("ein viel späterer Tap löst wieder aus (Sperre läuft ab)", () => {
    const { press } = make();
    press.start(0, 0);
    vi.advanceTimersByTime(LONG_PRESS_MS);
    press.end();
    vi.advanceTimersByTime(CLICK_SUPPRESS_MS + 1);
    expect(press.shouldSuppressClick()).toBe(false);
  });

  it("Bewegung über der Toleranz bricht ab (Scrollen), kleine Bewegung nicht", () => {
    const small = make();
    small.press.start(0, 0);
    small.press.move(MOVE_TOLERANCE_PX - 1, 0);
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(small.onLongPress).toHaveBeenCalledTimes(1);

    const far = make();
    far.press.start(0, 0);
    far.press.move(MOVE_TOLERANCE_PX + 1, 0);
    vi.advanceTimersByTime(LONG_PRESS_MS * 2);
    expect(far.onLongPress).not.toHaveBeenCalled();
    expect(far.press.end()).toBe(false);
    expect(far.press.shouldSuppressClick()).toBe(false);
  });

  it("cancel (pointercancel/Scroll) verhindert Auslösung und Sperre", () => {
    const { onLongPress, press } = make();
    press.start(0, 0);
    press.cancel();
    vi.advanceTimersByTime(LONG_PRESS_MS * 2);
    expect(onLongPress).not.toHaveBeenCalled();
    expect(press.shouldSuppressClick()).toBe(false);
  });

  it("ein neuer Druck startet frisch", () => {
    const { onLongPress, press } = make();
    press.start(0, 0);
    vi.advanceTimersByTime(LONG_PRESS_MS - 10);
    press.start(50, 50);
    vi.advanceTimersByTime(LONG_PRESS_MS - 10);
    expect(onLongPress).not.toHaveBeenCalled();
    vi.advanceTimersByTime(10);
    expect(onLongPress).toHaveBeenCalledTimes(1);
  });
});

describe("tipText", () => {
  it("Reihenfolge: data-tip, aria-label, title, Text", () => {
    expect(tipText({ dataTip: "a", ariaLabel: "b", title: "c", text: "d" })).toBe("a");
    expect(tipText({ ariaLabel: "b", title: "c", text: "d" })).toBe("b");
    expect(tipText({ title: "c", text: "d" })).toBe("c");
    expect(tipText({ text: "  Sende \n  jetzt " })).toBe("Sende jetzt");
    expect(tipText({ dataTip: "  ", text: "x" })).toBe("x");
  });
  it("leer bleibt leer, Langes wird gekürzt", () => {
    expect(tipText({})).toBe("");
    expect(tipText({ text: "x".repeat(300) }).length).toBe(118);
  });
});
