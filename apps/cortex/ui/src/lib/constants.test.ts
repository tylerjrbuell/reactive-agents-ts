import { describe, it, expect } from "bun:test";
import { CORTEX_COLORS, RECONNECT_DELAYS_MS, AGENT_STATE_COLORS } from "./constants.js";

describe("Cortex UI constants", () => {
  it("CORTEX_COLORS includes primary violet", () => {
    expect(CORTEX_COLORS.primary).toMatch(/^#/);
    expect(CORTEX_COLORS.secondary).toMatch(/^#/);
  });

  it("RECONNECT_DELAYS_MS is monotonic backoff ladder", () => {
    expect(RECONNECT_DELAYS_MS.length).toBeGreaterThanOrEqual(4);
    for (let i = 1; i < RECONNECT_DELAYS_MS.length; i++) {
      expect(RECONNECT_DELAYS_MS[i]).toBeGreaterThanOrEqual(RECONNECT_DELAYS_MS[i - 1]!);
    }
  });

  it("AGENT_STATE_COLORS covers every cognitive label", () => {
    const keys = Object.keys(AGENT_STATE_COLORS);
    for (const k of ["idle", "running", "exploring", "stressed", "completed", "error"]) {
      expect(keys).toContain(k);
    }
  });
});
