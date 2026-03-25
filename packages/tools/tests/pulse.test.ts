import { describe, it, expect } from "bun:test";
import { buildPulseResponse, pulseTool } from "../src/skills/pulse.js";
import type { PulseInput } from "../src/skills/pulse.js";

const baseSteps = [
  { type: "action", content: JSON.stringify({ tool: "rag-search", input: '{"query":"x"}' }), metadata: { toolUsed: "rag-search" } },
  { type: "observation", content: "results: []", metadata: { observationResult: { success: true } } },
];

const baseInput: PulseInput = {
  question: undefined,
  entropy: undefined,
  controllerDecisionLog: [],
  steps: baseSteps as any,
  iteration: 2,
  maxIterations: 10,
  tokens: 800,
  tokenBudget: 8000,
  task: "Find information about TypeScript.",
  allToolSchemas: [{ name: "web-search", description: "Search web", parameters: [] }],
  toolsUsed: new Set(["rag-search"]),
  requiredTools: [],
};

describe("pulseTool definition", () => {
  it("has name 'pulse'", () => expect(pulseTool.name).toBe("pulse"));
  it("has question parameter", () => {
    const names = pulseTool.parameters.map(p => p.name);
    expect(names).toContain("question");
  });
});

describe("buildPulseResponse — entropy unavailable", () => {
  it("returns unknown grade and -1 composite when no entropy", () => {
    const result = buildPulseResponse(baseInput) as any;
    expect(result.signal.grade).toBe("unknown");
    expect(result.signal.composite).toBe(-1);
    expect(result.signal.shape).toBe("unknown");
  });

  it("still populates behavior and context sections", () => {
    const result = buildPulseResponse(baseInput) as any;
    expect(typeof result.behavior.toolSuccessRate).toBe("number");
    expect(result.context.iterationsUsed).toBe(2);
    expect(result.context.iterationsRemaining).toBe(8);
  });

  it("always has recommendation string", () => {
    const result = buildPulseResponse(baseInput) as any;
    expect(typeof result.recommendation).toBe("string");
    expect(result.recommendation.length).toBeGreaterThan(0);
  });
});

describe("buildPulseResponse — with entropy", () => {
  const withEntropy: PulseInput = {
    ...baseInput,
    entropy: { composite: 0.72, shape: "flat", momentum: 0.01, history: [0.70, 0.71, 0.72] },
  };

  it("returns correct grade D for 0.72", () => {
    const result = buildPulseResponse(withEntropy) as any;
    expect(result.signal.grade).toBe("D");
  });

  it("flat entropy triggers appropriate recommendation", () => {
    const stuckInput: PulseInput = {
      ...withEntropy,
      iteration: 5,
      entropy: { composite: 0.6, shape: "flat", momentum: 0, history: [0.6, 0.6, 0.6, 0.6] },
    };
    const result = buildPulseResponse(stuckInput) as any;
    expect(result.recommendation.toLowerCase()).toContain("pivot");
  });
});

describe("buildPulseResponse — loopScore", () => {
  it("detects loop when same tool+args called multiple times", () => {
    const loopSteps = [
      { type: "action", content: JSON.stringify({ tool: "rag-search", input: '{"query":"x"}' }), metadata: {} },
      { type: "observation", content: "[]", metadata: { observationResult: { success: true } } },
      { type: "action", content: JSON.stringify({ tool: "rag-search", input: '{"query":"x"}' }), metadata: {} },
      { type: "observation", content: "[]", metadata: { observationResult: { success: true } } },
      { type: "action", content: JSON.stringify({ tool: "rag-search", input: '{"query":"x"}' }), metadata: {} },
      { type: "observation", content: "[]", metadata: { observationResult: { success: true } } },
    ];
    const result = buildPulseResponse({ ...baseInput, steps: loopSteps as any }) as any;
    expect(result.behavior.loopScore).toBeGreaterThan(0.5);
    expect(result.recommendation.toLowerCase()).toMatch(/repeat|approach|stuck/);
  });
});

describe("buildPulseResponse — readyToAnswer", () => {
  it("is false when no non-meta tool has been called", () => {
    const result = buildPulseResponse({ ...baseInput, toolsUsed: new Set(), iteration: 0 }) as any;
    expect(result.readyToAnswer).toBe(false);
    expect(result.blockers.length).toBeGreaterThan(0);
  });

  it("is true when conditions are met (no required tools, some tool called, iteration >= 1)", () => {
    const result = buildPulseResponse({
      ...baseInput,
      toolsUsed: new Set(["rag-search"]),
      iteration: 2,
      requiredTools: [],
    }) as any;
    expect(result.readyToAnswer).toBe(true);
  });

  it("is false when required tool not called", () => {
    const result = buildPulseResponse({
      ...baseInput,
      toolsUsed: new Set(["rag-search"]),
      requiredTools: ["web-search"],
      iteration: 2,
    }) as any;
    expect(result.readyToAnswer).toBe(false);
    expect(result.blockers.some((b: string) => b.includes("web-search"))).toBe(true);
  });
});
