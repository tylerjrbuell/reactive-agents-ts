import { describe, expect, test } from "bun:test";
import { placeTooltip } from "./tooltip-placement.js";

const viewport = { width: 1000, height: 800 };
const bubble = { width: 120, height: 30 };

describe("placeTooltip", () => {
  test("sits above a trigger with room, centred, caret on the trigger centre", () => {
    const p = placeTooltip({ trigger: { left: 400, top: 300, width: 40, height: 20 }, bubble, viewport });
    expect(p.side).toBe("top");
    expect(p.top).toBe(300 - 8 - 30);
    expect(p.left).toBe(420 - 60);
    expect(p.caretX).toBe(60);
  });

  test("flips below when the top has no room", () => {
    const p = placeTooltip({ trigger: { left: 400, top: 10, width: 40, height: 20 }, bubble, viewport });
    expect(p.side).toBe("bottom");
    expect(p.top).toBe(10 + 20 + 8);
  });

  test("honours a bottom preference and flips up at the viewport floor", () => {
    expect(placeTooltip({ trigger: { left: 400, top: 300, width: 40, height: 20 }, bubble, viewport, placement: "bottom" }).side).toBe("bottom");
    expect(placeTooltip({ trigger: { left: 400, top: 770, width: 40, height: 20 }, bubble, viewport, placement: "bottom" }).side).toBe("top");
  });

  test("clamps inside the right edge and keeps the caret on the trigger", () => {
    const p = placeTooltip({ trigger: { left: 970, top: 300, width: 24, height: 20 }, bubble, viewport });
    expect(p.left).toBe(1000 - 8 - 120);
    expect(p.left + p.caretX).toBeLessThanOrEqual(982);
    expect(p.caretX).toBeLessThanOrEqual(120 - 14);
  });

  test("clamps inside the left edge", () => {
    const p = placeTooltip({ trigger: { left: 0, top: 300, width: 20, height: 20 }, bubble, viewport });
    expect(p.left).toBe(8);
    expect(p.caretX).toBe(14);
  });

  test("a bubble taller than both sides takes the roomier side and stays on screen", () => {
    const p = placeTooltip({ trigger: { left: 400, top: 500, width: 40, height: 20 }, bubble: { width: 120, height: 700 }, viewport });
    expect(p.side).toBe("top");
    expect(p.top).toBe(8);
  });
});
