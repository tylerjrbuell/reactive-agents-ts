import { describe, it, expect } from "bun:test";
import { renderCalibrationProvenance } from "../src/renderers/calibration-provenance.js";

describe("renderCalibrationProvenance", () => {
  it("prints prior-only when no community and no local", () => {
    const line = renderCalibrationProvenance({
      modelId: "cogito",
      sources: ["prior"],
      localSamples: 0,
      summary: { parallelCallCapability: "partial" },
    });
    expect(line).toContain("prior-only");
    expect(line).toContain("cogito");
  });

  it("prints prior+local with sample count", () => {
    const line = renderCalibrationProvenance({
      modelId: "cogito",
      sources: ["prior", "local"],
      localSamples: 12,
      summary: { parallelCallCapability: "reliable", classifierReliability: "low" },
    });
    expect(line).toContain("prior+local");
    expect(line).toContain("12 samples");
    expect(line).toContain("parallel=reliable");
    expect(line).toContain("classifier=low");
  });

  it("includes community when present", () => {
    const line = renderCalibrationProvenance({
      modelId: "gemma4:e4b",
      sources: ["prior", "community", "local"],
      localSamples: 5,
      summary: {},
    });
    expect(line).toContain("prior+community+local");
  });

  it("omits summary fields that are undefined", () => {
    const line = renderCalibrationProvenance({
      modelId: "cogito",
      sources: ["prior"],
      localSamples: 0,
      summary: { parallelCallCapability: "partial" },
    });
    expect(line).not.toContain("classifier=");
  });
});
