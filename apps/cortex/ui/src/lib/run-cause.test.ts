import { describe, expect, test } from "bun:test";
import {
  attributionView,
  causeOpenByDefault,
  causeSteps,
  confidenceLabel,
  faultView,
  fetchRunCause,
  reasonWords,
  unavailableNote,
  whatToTry,
  type RunCauseReport,
} from "./run-cause.js";

const report: RunCauseReport = {
  available: true,
  runId: "R1",
  cause: "tool-failure",
  subCause: "all-calls-failed",
  headline: "Tool calls kept failing",
  confidence: "decisive",
  outcomeStatus: "failure",
  evidence: [
    { eventKind: "tool-call-end", seq: 4, detail: "3/3 failed", loop: 2 },
    { eventKind: "run-completed", seq: 9, detail: "status=failure", loop: null },
  ],
  missing: [],
  attribution: {
    verdict: "environment",
    reason: "environment:tool-failure",
    confidence: "probable",
    evidence: [
      { eventKind: "tool-call-end", seq: 4, detail: "dup", loop: 2 },
      { eventKind: "llm-exchange", seq: 7, detail: "turn", loop: 7 },
    ],
    missing: [],
    alsoMatched: [],
  },
};

describe("run cause view rules", () => {
  test("a step-limit stop that ended on a dropped tool call reads as a step limit, not a harness fault", () => {
    const stop: Extract<RunCauseReport, { available: true }> = {
      ...report,
      cause: "budget-cap",
      subCause: "cap-cutoff",
      attribution: { ...report.attribution, verdict: "harness", reason: "harness:tool-call-dropped" },
    };
    const v = faultView(stop);
    expect(v.label).toBe("Step limit");
    expect(v.text).toBe("The run reached its step limit before the model's last tool call could run. Raise the step limit or Continue.");
    expect(v.text).not.toContain("Harness");
    // A token budget or any other cause keeps the framework's owner and reason.
    expect(faultView({ ...stop, subCause: "token-budget" }).text).toBe("Harness: tool call dropped");
    expect(faultView({ ...stop, cause: "tool-protocol" }).label).toBe("Harness");
    expect(faultView(report)).toEqual({ label: "Environment", tone: "io", text: "Environment: tool failure" });
  });

  test("What to try lists the framework's next actions as given; none for no diagnosis or an older server", () => {
    expect(whatToTry({ ...report, nextActions: ["Check the tool's endpoint.", "Retry."] })).toEqual(["Check the tool's endpoint.", "Retry."]);
    expect(whatToTry(report)).toEqual([]);
    expect(whatToTry({ available: false, reason: "no-trace" })).toEqual([]);
  });

  test("opens for failed, abstained, partial and stopped runs; collapsed for a success", () => {
    expect(causeOpenByDefault("failed", undefined)).toBe(true);
    expect(causeOpenByDefault("completed", "abstained")).toBe(true);
    expect(causeOpenByDefault("completed", "partial")).toBe(true);
    expect(causeOpenByDefault("stopped", undefined)).toBe(true);
    expect(causeOpenByDefault("completed", undefined)).toBe(false);
  });

  test("steps dedupe by seq across cause and attribution; link only to existing trace rows", () => {
    const steps = causeSteps(report, new Set([1, 2, 3]));
    expect(steps.map((s) => s.seq)).toEqual([4, 9, 7]);
    expect(steps.map((s) => s.linked)).toEqual([true, false, false]);
    expect(steps[0]?.detail).toBe("3/3 failed");
    expect(causeSteps({ available: false, reason: "no-trace" }, new Set([1]))).toEqual([]);
  });

  test("words for attribution, confidence, reasons and missing diagnoses", () => {
    expect(attributionView("harness")).toEqual({ label: "Harness", tone: "accent" });
    expect(attributionView("unattributed").label).toBe("Cannot tell");
    expect(attributionView("not-failed").tone).toBe("ok");
    expect(confidenceLabel("insufficient-trace")).toBe("Trace too thin to tell");
    expect(reasonWords("harness:stall-after-work")).toBe("stall after work");
    expect(reasonWords("unattributed")).toBe("unattributed");
    expect(unavailableNote("no-trace")).toContain("no trace file");
  });

  test("fetchRunCause reads the cause route and throws on a server error", async () => {
    let url = "";
    const ok = async (u: string): Promise<Response> => {
      url = u;
      return new Response(JSON.stringify({ available: false, reason: "no-trace" }));
    };
    expect(await fetchRunCause("R 1", ok)).toEqual({ available: false, reason: "no-trace" });
    expect(url).toEndWith("/api/runs/R%201/cause");
    const bad = async (): Promise<Response> => new Response("x", { status: 500 });
    await expect(fetchRunCause("R1", bad)).rejects.toThrow("500");
  });
});
