import { describe, expect, it } from "bun:test";
import type { RunAnalysis } from "@reactive-agents/trace";
import {
  diagnoseRun,
  formatDiagnosisLine,
  projectDiagnosis,
  trustVerdict,
} from "../src/diagnose.js";

describe("trustVerdict (score-aware)", () => {
  it("claimed-success (unverified) + high accuracy → verified-correct", () => {
    expect(trustVerdict("claimed-success (unverified)", 1.0)).toBe("verified-correct");
    expect(trustVerdict("claimed-success (unverified)", 0.5)).toBe("verified-correct");
  });
  it("claimed-success (unverified) + low accuracy → claimed-but-wrong (overconfidence)", () => {
    expect(trustVerdict("claimed-success (unverified)", 0.2)).toBe("claimed-but-wrong");
    expect(trustVerdict("claimed-success (unverified)", 0)).toBe("claimed-but-wrong");
  });
  it("dishonest-success-suspected → dishonest (regardless of score)", () => {
    expect(trustVerdict("dishonest-success-suspected", 1.0)).toBe("dishonest");
  });
  it("honest-failure → honest-failure", () => {
    expect(trustVerdict("honest-failure", 0)).toBe("honest-failure");
  });
  it("unverified with no score → unknown", () => {
    expect(trustVerdict("claimed-success (unverified)", undefined)).toBe("unknown");
  });
  it("no honesty label → unknown", () => {
    expect(trustVerdict(undefined, 1.0)).toBe("unknown");
  });
  it("respects a custom threshold", () => {
    expect(trustVerdict("claimed-success (unverified)", 0.6, 0.7)).toBe("claimed-but-wrong");
    expect(trustVerdict("claimed-success (unverified)", 0.8, 0.7)).toBe("verified-correct");
  });
});

// Minimal RunAnalysis fixture — only the fields projectDiagnosis reads.
function analysis(p: {
  label?: string;
  evidence?: string;
  failureModes?: { mode: string; evidence: string }[];
  blindSpots?: { metric: string; reason: string }[];
}): RunAnalysis {
  return {
    runId: "t1",
    iterations: 3,
    honesty: {
      claimedSuccess: true,
      deliverableProduced: false,
      substantiveWorkDone: false,
      label: p.label ?? "honest-failure",
      evidence: p.evidence ?? "no claim",
    },
    interventions: {} as RunAnalysis["interventions"],
    pressure: {} as RunAnalysis["pressure"],
    cost: {} as RunAnalysis["cost"],
    reasoning: {} as RunAnalysis["reasoning"],
    tools: [],
    failureModes: p.failureModes ?? [],
    coverage: { blindSpots: p.blindSpots ?? [] } as RunAnalysis["coverage"],
  } as RunAnalysis;
}

describe("projectDiagnosis", () => {
  it("projects honesty label + evidence", () => {
    const d = projectDiagnosis(
      analysis({ label: "dishonest-success-suspected", evidence: "claimed success, no deliverable" }),
    );
    expect(d.honestyLabel).toBe("dishonest-success-suspected");
    expect(d.honestyEvidence).toBe("claimed success, no deliverable");
  });

  it("carries failure modes through", () => {
    const d = projectDiagnosis(
      analysis({ failureModes: [{ mode: "nudge-loop", evidence: "recall steered 4x" }] }),
    );
    expect(d.failureModes).toEqual([{ mode: "nudge-loop", evidence: "recall steered 4x" }]);
  });

  it("flattens blind spots to strings", () => {
    const d = projectDiagnosis(
      analysis({ blindSpots: [{ metric: "cache-tokens", reason: "no llm-exchange events" }] }),
    );
    expect(d.blindSpots.length).toBe(1);
    expect(d.blindSpots[0]).toContain("cache-tokens");
    expect(d.blindSpots[0]).toContain("no llm-exchange events");
  });
});

describe("formatDiagnosisLine", () => {
  it("returns null when nothing is flagged (honest, no modes, no blind spots)", () => {
    const d = projectDiagnosis(analysis({ label: "honest-failure", evidence: "tried, failed cleanly" }));
    // honest-failure with no modes/blindspots is not flag-worthy
    expect(formatDiagnosisLine(d)).toBeNull();
  });

  it("renders a line when honesty is suspect", () => {
    const d = projectDiagnosis(
      analysis({ label: "dishonest-success-suspected", evidence: "no deliverable" }),
    );
    const line = formatDiagnosisLine(d);
    expect(line).not.toBeNull();
    expect(line!).toContain("dishonest-success-suspected");
  });

  it("renders a line when a failure mode is present", () => {
    const d = projectDiagnosis(
      analysis({ label: "honest-failure", failureModes: [{ mode: "nudge-loop", evidence: "recall x4" }] }),
    );
    const line = formatDiagnosisLine(d);
    expect(line).not.toBeNull();
    expect(line!).toContain("nudge-loop");
  });
});

describe("diagnoseRun (best-effort)", () => {
  it("returns undefined when traceDir is undefined", async () => {
    expect(await diagnoseRun(undefined, "t1")).toBeUndefined();
  });

  it("returns undefined when traceDir is empty string", async () => {
    expect(await diagnoseRun("", "t1")).toBeUndefined();
  });

  it("returns undefined (never throws) when the trace file does not exist", async () => {
    expect(await diagnoseRun("/nonexistent-dir-xyz-12345", "no-such-task")).toBeUndefined();
  });
});
