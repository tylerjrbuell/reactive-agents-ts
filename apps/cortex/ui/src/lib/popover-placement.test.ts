import { describe, expect, test } from "bun:test";
import { placePopover } from "./popover-placement.js";

const viewport = { width: 1000, height: 800 };
const size = { width: 300, height: 200 };

describe("placePopover", () => {
  test("opens below the trigger, lined up with its start edge", () => {
    const p = placePopover({ trigger: { left: 100, top: 100, width: 60, height: 24 }, size, viewport });
    expect(p).toMatchObject({ side: "bottom", left: 100, top: 100 + 24 + 6 });
  });

  test("end alignment puts the popover's right edge under the trigger's right edge", () => {
    const p = placePopover({ trigger: { left: 800, top: 100, width: 60, height: 24 }, size, viewport, align: "end" });
    expect(p.left).toBe(860 - 300);
  });

  test("flips above when the preferred side lacks room", () => {
    const p = placePopover({ trigger: { left: 100, top: 700, width: 60, height: 24 }, size, viewport });
    expect(p.side).toBe("top");
    expect(p.top).toBe(700 - 6 - 200);
  });

  test("a top preference flips below at the viewport ceiling", () => {
    const p = placePopover({ trigger: { left: 100, top: 20, width: 60, height: 24 }, size, viewport, side: "top" });
    expect(p.side).toBe("bottom");
  });

  test("shifts inside the viewport on both horizontal edges", () => {
    expect(placePopover({ trigger: { left: 900, top: 100, width: 60, height: 24 }, size, viewport }).left).toBe(1000 - 8 - 300);
    expect(placePopover({ trigger: { left: 2, top: 100, width: 20, height: 24 }, size, viewport, align: "end" }).left).toBe(8);
  });

  test("takes the roomier side and caps the height when neither fits", () => {
    const tall = { width: 300, height: 900 };
    const p = placePopover({ trigger: { left: 100, top: 500, width: 60, height: 24 }, size: tall, viewport });
    expect(p.side).toBe("top");
    expect(p.maxHeight).toBe(500 - 6 - 8);
    expect(p.top).toBe(500 - 6 - p.maxHeight);
    expect(p.top).toBeGreaterThanOrEqual(8);
  });

  test("a popover wider than the viewport pins to the left margin", () => {
    const p = placePopover({ trigger: { left: 50, top: 100, width: 20, height: 20 }, size: { width: 2000, height: 50 }, viewport });
    expect(p.left).toBe(8);
  });
});
