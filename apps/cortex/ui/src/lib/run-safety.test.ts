import { describe, expect, it } from "bun:test";
import { safetyBadgeTone, safetyCountLabel, safetyIcon, safetyKindLabel, safetyMarkLabel } from "./run-safety.js";
import { ICON_PATHS as ICONS } from "./icons.js";

describe("run safety lane presentation", () => {
  it("every mechanism has a kit icon and a name", () => {
    for (const kind of ["intervention", "guardrail", "verifier", "budget", "context", "calibration"] as const) {
      expect(ICONS[safetyIcon(kind)]).toBeDefined();
      expect(safetyKindLabel(kind)).toMatch(/^[A-Z][a-z]+$/);
    }
  });

  it("maps tones onto kit badge tones", () => {
    expect(safetyBadgeTone("info")).toBe("accent");
    expect(safetyBadgeTone("warn")).toBe("warn");
    expect(safetyBadgeTone("bad")).toBe("bad");
    expect(safetyBadgeTone("ok")).toBe("ok");
  });

  it("counts in words", () => {
    expect(safetyCountLabel(1)).toBe("1 safety event");
    expect(safetyCountLabel(4)).toBe("4 safety events");
    expect(safetyMarkLabel({ count: 2, tone: "warn" })).toBe("2 safety events in this loop");
  });
});
