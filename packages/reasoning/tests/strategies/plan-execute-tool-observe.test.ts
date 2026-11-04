// File: tests/strategies/plan-execute-tool-observe.test.ts
//
// Phase C of the canonical tool-execution plan (#195 / FM-I).
//
// plan-execute's `tool_call` branch hand-rolled a direct ToolService dispatch
// that NEVER emitted the `observation.tool-result` Compose tag — so `.on()` /
// `.tap()` hooks registered on a plan-execute-reflect agent were dead for tool
// steps. After routing the branch through `executeToolAndObserve`, the tag
// fires identically to the kernel act path, healing applies, and observation
// metadata is guaranteed. The verifier + semantic-memory enrichments stay OFF
// (parity-cheap opt-out).
import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { LLMService, TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { mockToolServiceLayer } from "../../src/testing/tool-service-mock.js";
import { HarnessPipeline, RegistrationHarness } from "@reactive-agents/core";
import { executePlanExecute } from "../../src/strategies/plan-execute.js";
import { defaultReasoningConfig } from "../../src/types/config.js";
import { provideTestEnvelope } from "../../src/kernel/envelope/run-envelope.js";
import { priorResultsBudgetChars, priorResultsForPrompt } from "../../src/strategies/planning/prior-results.js";

/** Minimal ReasoningStep-ish shape the observation.tool-result tap receives. */
interface ObsStepLike {
  readonly type: string;
  readonly metadata?: {
    readonly toolCallId?: string;
    readonly verification?: unknown;
    readonly observationResult?: { readonly toolName?: string; readonly success?: boolean };
  };
}

/**
 * Stub ToolService that records every executed tool name (so the healing test
 * can assert the misspelled name was repaired before dispatch) and exposes a
 * `web-search` schema so the HealingPipeline has a fuzzy-match target.
 */
function makeRecordingToolService() {
  const executed: string[] = [];
  const layer = mockToolServiceLayer({
    execute: (req: { toolName: string }) => {
      executed.push(req.toolName);
      return Effect.succeed({
        success: true,
        result: { results: [{ title: "hit", url: "https://example.com", content: "data" }] },
      });
    },
    getTool: (name: string) =>
      Effect.succeed({
        name,
        description: "test tool",
        parameters: [{ name: "query", type: "string", required: true }],
      }),
    register: () => Effect.void,
    listTools: () => Effect.succeed([]),
    deregister: () => Effect.void,
  });
  return { executed, layer };
}

/** Recording pipeline — taps observation.tool-result + lifecycle.failure. */
function recordingPipeline() {
  const observations: ObsStepLike[] = [];
  const rh = new RegistrationHarness();
  rh.tap("observation.tool-result", (step: ObsStepLike) => {
    observations.push(step);
  });
  return { pipeline: new HarnessPipeline(rh._collected), observations };
}

/** web-search schema the planner/heal config sees. */
const WEB_SEARCH_SCHEMA = {
  name: "web-search",
  description: "Search the web",
  parameters: [{ name: "query", type: "string", description: "query", required: true }],
};

function planJson(toolName: string): string {
  return JSON.stringify({
    steps: [
      {
        title: "Search",
        instruction: "search the web",
        type: "tool_call",
        toolName,
        toolArgs: { query: "test" },
        rationale: { why: "need data", confidence: 0.9 },
      },
      { title: "Summarize", instruction: "summarize the result", type: "analysis" },
    ],
  });
}

/** LLM turns for a tool_call + analysis plan through reflection + synthesis. */
function planExecuteTurns(toolName: string) {
  return TestLLMServiceLayer([
    { match: "planning agent", text: planJson(toolName) },
    { match: "OVERALL GOAL", text: "FINAL ANSWER: summary done." },
    { match: "GOAL:", text: "SATISFIED: complete." },
    { match: "Synthesize", text: "Final synthesized answer." },
  ]);
}

const baseInput = {
  taskDescription: "Find test data",
  taskType: "simple",
  memoryContext: "",
  availableTools: ["web-search"] as string[],
  availableToolSchemas: [WEB_SEARCH_SCHEMA],
  config: defaultReasoningConfig,
};

// Repro (H3 rw-3, 2026-11-04, 8 failures on both tiers): an analysis step that
// had to summarize a 46-row file saw the compressed preview (3 rows + "...43 more
// lines") in DATA FROM PREVIOUS STEPS and wrote its report from 3 rows.
describe("plan-execute analysis step sees the full prior tool data", () => {
  // ~5,000 chars: above every tier's per-result preview budget, far below the recency budget.
  const rows = Array.from({ length: 46 }, (_, i) => `ROW-${String(i + 1).padStart(3, "0")},employee-name-${i + 1},department-${i % 5},senior-title-${i % 7},${50_000 + i * 1000},${(i % 9) + 1}`);
  const csv = ["id,name,department,salary", ...rows].join("\n");

  function csvToolLayer() {
    return mockToolServiceLayer({
      execute: () => Effect.succeed({ success: true, result: csv }),
      getTool: (name: string) => Effect.succeed({ name, description: "test tool", parameters: [{ name: "query", type: "string", required: true }] }),
      register: () => Effect.void,
      listTools: () => Effect.succeed([]),
      deregister: () => Effect.void,
    });
  }

  it("priorResultsForPrompt: newest first gets full data within the budget; the rest keep previews", () => {
    const steps = [
      { id: "s1", title: "a", result: "A-preview", fullResult: "A".repeat(60) },
      { id: "s2", title: "b", result: "B-preview", fullResult: "B".repeat(60) },
      { id: "s3", title: "c" },
    ];
    expect(priorResultsForPrompt(steps, 100).map((r) => r.result)).toEqual(["A-preview", "B".repeat(60)]);
    expect(priorResultsForPrompt(steps, 120).map((r) => r.result)).toEqual(["A".repeat(60), "B".repeat(60)]);
    expect(priorResultsForPrompt(steps, 0).map((r) => r.result)).toEqual(["A-preview", "B-preview"]);
    expect(priorResultsBudgetChars(undefined)).toBe(Math.floor(32_768 * 0.35 * 4));
  });

  it("the analysis prompt carries every row, not the preview", async () => {
    // Sequential plan: the analysis step depends on the tool step (as rw-3's did).
    const plan = JSON.parse(planJson("web-search")) as { steps: Record<string, unknown>[] };
    plan.steps[1] = { ...plan.steps[1], dependsOn: ["s1"] };
    const turns = TestLLMServiceLayer([
      { match: "planning agent", text: JSON.stringify(plan) },
      // Answers only when the LAST row reached the analysis prompt.
      { match: "OVERALL GOAL[\\s\\S]*ROW-046|ROW-046[\\s\\S]*OVERALL GOAL", text: "FINAL ANSWER: SAW-ALL-ROWS" },
      { match: "OVERALL GOAL", text: "FINAL ANSWER: SAW-PREVIEW" },
      { match: "GOAL:", text: "SATISFIED: complete." },
      { match: "SAW-ALL-ROWS", text: "OUT-FULL" },
      { text: "OUT-PREVIEW" },
    ]);
    const result = await Effect.runPromise(provideTestEnvelope(
      executePlanExecute({ ...baseInput, harnessPipeline: recordingPipeline().pipeline }).pipe(
        Effect.provide(Layer.merge(turns, csvToolLayer())),
      ),
    ));
    expect(result.status).toBe("completed");
    expect(String(result.output)).toContain("OUT-FULL");
  });
});

// D9 P1: a composite step's sub-kernel ran tools that never reached the plan's
// run ledger, so a plan-level delivery check could not see them.
describe("plan-execute composite step evidence reaches the run ledger", () => {
  it("a tool the composite step's sub-kernel called is in result.metadata.runLedger", async () => {
    const plan = {
      steps: [
        { title: "Gather", instruction: "Look up ZETA-UNIQUE data.", type: "composite", toolHints: ["web-search"] },
      ],
    };
    const turns = TestLLMServiceLayer([
      { match: "planning agent", text: JSON.stringify(plan) },
      { match: "ZETA-UNIQUE[\\s\\S]*web-search|web-search[\\s\\S]*ZETA-UNIQUE", toolCall: { name: "web-search", args: { query: "zeta" } } },
      { match: "GOAL:", text: "SATISFIED: complete." },
      { match: "Synthesize", text: "Final synthesized answer." },
      { text: "FINAL ANSWER: gathered." },
    ]);
    const { layer: toolLayer } = makeRecordingToolService();
    const result = await Effect.runPromise(provideTestEnvelope(
      executePlanExecute({ ...baseInput, harnessPipeline: recordingPipeline().pipeline }).pipe(
        Effect.provide(Layer.merge(turns, toolLayer)),
      ),
    ));
    const ledger = (result.metadata as { runLedger?: readonly { kind: string; toolName?: string }[] }).runLedger ?? [];
    expect(ledger.some((e) => e.kind === "tool-invocation" && e.toolName === "web-search")).toBe(true);
    expect(ledger.some((e) => e.kind === "tool-result" && e.toolName === "web-search")).toBe(true);
  });
});

// D9 P2: plan-execute's result carries a real delivery verdict (it was null).
describe("plan-execute result carries the shared delivery verdict", () => {
  const outcomeOf = (r: { metadata: { extensions?: unknown } }) =>
    (r.metadata.extensions as { terminalOutcome?: { verdict?: { accepted: boolean } | null; status: string } } | undefined)?.terminalOutcome;
  const run = (taskDescription: string) =>
    Effect.runPromise(provideTestEnvelope(
      executePlanExecute({ ...baseInput, taskDescription, harnessPipeline: recordingPipeline().pipeline }).pipe(
        Effect.provide(Layer.merge(planExecuteTurns("web-search"), makeRecordingToolService().layer)),
      ),
    ));

  it("plain answer: completed with an accepted verdict", async () => {
    const o = outcomeOf(await run("Find test data"));
    expect(o?.verdict?.accepted).toBe(true);
    expect(o?.status).toBe("completed");
  });

  it("a named file never written: verdict refused, not completed", async () => {
    const o = outcomeOf(await run("Find test data and write it to d9-pe-never-written-c41e.md"));
    expect(o?.verdict?.accepted).toBe(false);
    expect(o?.status).not.toBe("completed");
  });
});

describe("plan-execute tool_call → executeToolAndObserve (#195)", () => {
  it("fires observation.tool-result for a tool_call step", async () => {
    const { pipeline, observations } = recordingPipeline();
    const { layer: toolLayer } = makeRecordingToolService();

    const result = await Effect.runPromise(provideTestEnvelope(
      executePlanExecute({ ...baseInput, harnessPipeline: pipeline }).pipe(
        Effect.provide(Layer.merge(planExecuteTurns("web-search"), toolLayer)),
      ),
    ));

    expect(result.status).toBe("completed");
    // BUG (#195): currently 0 — the tool_call branch never emits the tag.
    expect(observations.length).toBeGreaterThanOrEqual(1);
    const obs = observations[0]!;
    expect(obs.type).toBe("observation");
    expect(obs.metadata?.observationResult?.toolName).toBe("web-search");
    expect(obs.metadata?.observationResult?.success).toBe(true);
  });

  it("applies healing — a misspelled tool name is repaired before dispatch", async () => {
    const { pipeline } = recordingPipeline();
    const { executed, layer: toolLayer } = makeRecordingToolService();

    const result = await Effect.runPromise(provideTestEnvelope(
      executePlanExecute({ ...baseInput, harnessPipeline: pipeline }).pipe(
        Effect.provide(Layer.merge(planExecuteTurns("websearch"), toolLayer)),
      ),
    ));

    expect(result.status).toBe("completed");
    // Healing fuzzy-matches "websearch" → "web-search" before ToolService.execute.
    expect(executed).toContain("web-search");
  });

  it("opt-outs hold — no verifier metadata, no MemoryService required", async () => {
    const { pipeline, observations } = recordingPipeline();
    const { layer: toolLayer } = makeRecordingToolService();

    // No MemoryService layer is provided; the run must resolve regardless
    // (semantic-memory store is OFF for plan-execute tool_call).
    const result = await Effect.runPromise(provideTestEnvelope(
      executePlanExecute({ ...baseInput, harnessPipeline: pipeline }).pipe(
        Effect.provide(Layer.merge(planExecuteTurns("web-search"), toolLayer)),
      ),
    ));

    expect(result.status).toBe("completed");
    expect(observations.length).toBeGreaterThanOrEqual(1);
    expect(observations[0]!.metadata?.verification).toBeUndefined();
  });
});
