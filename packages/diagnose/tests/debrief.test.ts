import { describe, it, expect } from "bun:test";
import { foldDebrief, buildDebrief } from "../src/debrief/build.js";
import { renderDebrief } from "../src/debrief/renderer.js";
import type { TraceEvent } from "@reactive-agents/trace";
import * as fs from "node:fs";
import * as path from "node:path";

const runId = "run-debrief-test";

const makeEvents = (): TraceEvent[] => [
  {
    kind: "run-started",
    runId, iter: -1, seq: 0, timestamp: 1000,
    task: "find current price of AAPL stock",
    model: "test", provider: "test", config: {},
  },
  {
    kind: "tool-call-start",
    runId, iter: 1, seq: 1, timestamp: 1100,
    toolName: "web_search",
    rationale: { why: "needs fresh price data", refs: ["scratch:goal"] },
  },
  {
    kind: "assumption-recorded",
    runId, iter: 1, seq: 2, timestamp: 1200,
    assumption: "user means USD",
    rationale: { why: "no currency specified", confidence: 0.6 },
  },
  {
    kind: "tool-call-start",
    runId, iter: 2, seq: 3, timestamp: 2000,
    toolName: "calculator",
    rationale: { why: "verify cited number" },
  },
  {
    kind: "curator-decision",
    runId, iter: 2, seq: 4, timestamp: 2100,
    action: "marked-untrusted",
    targetRef: "obs:scrape-1",
    rationale: { why: "no audit trail" },
  },
  {
    kind: "alternatives-considered",
    runId, iter: 2, seq: 5, timestamp: 2200,
    chosen: "calculator",
    alternatives: [{ option: "ask-human", rejectedBecause: "no human in loop" }],
  },
  {
    kind: "kernel-state-snapshot",
    runId, iter: 3, seq: 6, timestamp: 3000,
    status: "done",
    toolsUsed: ["web_search", "calculator"],
    scratchpadKeys: ["goal"],
    stepsCount: 6,
    stepsByType: {},
    outputPreview: "AAPL: $190.42 USD",
    outputLen: 18,
    messagesCount: 7,
    tokens: 1500,
    cost: 0.02,
    llmCalls: 3,
    terminatedBy: "quality_threshold",
    pendingGuidance: undefined,
    terminationRationale: { why: "quality 0.92 ≥ threshold 0.90" },
  },
  {
    kind: "run-completed",
    runId, iter: -1, seq: 7, timestamp: 3500,
    status: "success",
    totalTokens: 1500,
    totalCostUsd: 0.02,
    durationMs: 2500,
  },
];

describe("foldDebrief", () => {
  it("captures goal from run-started", () => {
    const d = foldDebrief(makeEvents(), runId);
    expect(d.goal).toBe("find current price of AAPL stock");
  });

  it("captures all tool calls with rationales", () => {
    const d = foldDebrief(makeEvents(), runId);
    expect(d.path).toHaveLength(2);
    expect(d.path[0]?.action).toBe("tool:web_search");
    expect(d.path[0]?.rationale?.why).toBe("needs fresh price data");
    expect(d.path[1]?.action).toBe("tool:calculator");
  });

  it("captures assumption", () => {
    const d = foldDebrief(makeEvents(), runId);
    expect(d.assumptions).toHaveLength(1);
    expect(d.assumptions[0]?.assumption).toBe("user means USD");
    expect(d.assumptions[0]?.rationale.confidence).toBe(0.6);
  });

  it("captures curator decision", () => {
    const d = foldDebrief(makeEvents(), runId);
    expect(d.curatorActions).toHaveLength(1);
    expect(d.curatorActions[0]?.action).toBe("marked-untrusted");
    expect(d.curatorActions[0]?.targetRef).toBe("obs:scrape-1");
  });

  it("captures alternatives", () => {
    const d = foldDebrief(makeEvents(), runId);
    expect(d.alternatives).toHaveLength(1);
    expect(d.alternatives[0]?.chosen).toBe("calculator");
    expect(d.alternatives[0]?.rejected[0]?.option).toBe("ask-human");
  });

  it("captures termination with rationale", () => {
    const d = foldDebrief(makeEvents(), runId);
    expect(d.termination.by).toBe("quality_threshold");
    expect(d.termination.rationale?.why).toMatch(/quality.*0\.92.*threshold/);
  });

  it("captures verdict", () => {
    const d = foldDebrief(makeEvents(), runId);
    expect(d.verdict?.status).toBe("success");
    expect(d.verdict?.tokens).toBe(1500);
    expect(d.verdict?.durationMs).toBe(2500);
  });

  it("returns empty path when no rationale-bearing events", () => {
    const d = foldDebrief([], runId);
    expect(d.path).toEqual([]);
    expect(d.assumptions).toEqual([]);
    expect(d.termination.by).toBe("unknown");
  });
});

describe("renderDebrief (markdown)", () => {
  it("includes goal, path, why, assumptions, curator, alternatives, termination, verdict", () => {
    const d = foldDebrief(makeEvents(), runId);
    const md = renderDebrief(d, "markdown");
    expect(md).toContain(`Debrief: run ${runId}`);
    expect(md).toContain("Goal: find current price of AAPL stock");
    expect(md).toContain("Path: web_search → calculator");
    expect(md).toContain("Why this path");
    expect(md).toContain("needs fresh price data");
    expect(md).toContain("refs: scratch:goal");
    expect(md).toContain("Assumptions");
    expect(md).toContain("user means USD");
    expect(md).toContain("conf: 0.60");
    expect(md).toContain("Curator");
    expect(md).toContain("marked-untrusted obs:scrape-1");
    expect(md).toContain("Alternatives considered");
    expect(md).toContain("ask-human");
    expect(md).toContain("Termination: quality_threshold");
    expect(md).toContain("Verdict: success");
    expect(md).toContain("1500 tok");
  });

  it("renders json shape when format is json", () => {
    const d = foldDebrief(makeEvents(), runId);
    const json = renderDebrief(d, "json");
    const parsed = JSON.parse(json);
    expect(parsed.runId).toBe(runId);
    expect(parsed.path).toHaveLength(2);
  });
});

describe("buildDebrief (file path)", () => {
  it("loads from JSONL fixture and folds correctly", async () => {
    const tmpDir = "/tmp/debrief-fixture-test";
    fs.mkdirSync(tmpDir, { recursive: true });
    const fixturePath = path.join(tmpDir, "trace.jsonl");
    fs.writeFileSync(
      fixturePath,
      makeEvents().map((e) => JSON.stringify(e)).join("\n") + "\n",
    );
    try {
      const d = await buildDebrief(fixturePath);
      expect(d.runId).toBe(runId);
      expect(d.path).toHaveLength(2);
      expect(d.termination.by).toBe("quality_threshold");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
