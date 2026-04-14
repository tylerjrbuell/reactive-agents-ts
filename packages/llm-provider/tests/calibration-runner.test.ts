import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { majority, median } from "../src/calibration-runner.js";

describe("probe helpers", () => {
  describe("majority", () => {
    it("should return majority value", () => {
      expect(majority(["a", "a", "b"])).toBe("a");
      expect(majority(["reliable", "partial", "reliable"])).toBe("reliable");
    });

    it("should return first value on tie", () => {
      expect(majority(["a", "b", "c"])).toBe("a");
    });

    it("should handle single value", () => {
      expect(majority(["only"])).toBe("only");
    });

    it("should throw on empty array", () => {
      expect(() => majority([])).toThrow();
    });
  });

  describe("median", () => {
    it("should return middle value", () => {
      expect(median([1, 2, 3])).toBe(2);
      expect(median([1000, 2000, 1500])).toBe(1500);
    });

    it("should average two middle values for even length", () => {
      expect(median([1, 2, 3, 4])).toBe(2.5);
    });

    it("should handle single value", () => {
      expect(median([42])).toBe(42);
    });
  });
});

describe("calibration runner with mock Ollama", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("should aggregate probe results across multiple runs", async () => {
    globalThis.fetch = (async (_url: string, _init?: any) => {
      return new Response(
        JSON.stringify({
          model: "test-model",
          message: { role: "assistant", content: "BLUE" },
          done: true,
        }),
        { headers: { "Content-Type": "application/json" } },
      );
    }) as any;

    const { runCalibrationProbes } = await import("../src/calibration-runner.js");
    const result = await runCalibrationProbes("test-model", 1);
    expect(result.modelId).toBe("test-model");
    expect(result.runsAveraged).toBe(1);
    expect(result.probeVersion).toBe(1);
    expect(typeof result.calibratedAt).toBe("string");
    expect(typeof result.optimalToolResultChars).toBe("number");
  });
});
