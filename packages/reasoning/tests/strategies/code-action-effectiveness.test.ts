// Run: bun test packages/reasoning/tests/strategies/code-action-effectiveness.test.ts --timeout 20000
//
// Cortex traces 2026-11-19 (gpt-4o, code-action, umami MCP attached, task
// "Analyze my umami website stats for the last week and provide a full
// analysis report"):
//   A  01M7T7A58VBP4CHMSJPKQ516SR / 01M7T7C5JZ2K8TKZN8KE8PSNRF: the model guessed
//      the result shape (`websites[0].websiteId`, then `.results`); the repair
//      prompt carried only the error, so each guess was blind. 3 attempts.
//   B  the same runs shipped the program's raw JSON as the "report".
//   C  01M7T7BJMFHVT2PCHNYWMG9S4P: the code returned "No website available for
//      analysis." although list_websites returned one site; graded success.
//
// Pinned here:
//   A  the sandbox-failure repair prompt shows the real result shape of every
//      call that succeeded first (strategies/code-action/result-shape.ts):
//      the trace replay completes on attempt 2;
//   B  a structured program result gets one answer-writing call through the
//      shared quality gate (strategies/code-action/answer-synthesis.ts); a task
//      that asks for JSON keeps the raw result;
//   C  a nothing-found answer contradicted by the run's tool data is a FAIL
//      verdict (kernel/capabilities/verify/contradicted-empty.ts): repaired
//      with the contradiction stated, failed at the cap; negative controls
//      (no data, an unrelated claim) still complete.
//
// RED-ON-CUT (verified 2026-11-19): drop `shapes` from the repair prompt (A
// pin takes 3 attempts and fails), return `undefined` from
// `writeCodeActionAnswer`'s synthesis branch (B pins ship raw JSON), drop the
// contradiction check in `unusableSandboxResult` (C pins complete).
import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import type { ToolService } from "@reactive-agents/tools";
import { TestLLMServiceLayer, type TestTurn } from "@reactive-agents/llm-provider";
import { mockToolServiceLayer } from "../../src/testing/tool-service-mock.js";
import { executeCodeAction } from "../../src/strategies/code-action.js";
import { describeValueShape, formatResultShapes } from "../../src/strategies/code-action/result-shape.js";
import { planCodeActionAnswer } from "../../src/strategies/code-action/answer-synthesis.js";
import {
  carriesData,
  contradictedEmptyAnswer,
  isNothingFoundClaim,
} from "../../src/kernel/capabilities/verify/contradicted-empty.js";
import { defaultReasoningConfig } from "../../src/types/config.js";
import { provideTestEnvelope, buildRunEnvelope } from "../../src/kernel/envelope/run-envelope.js";

const TASK = "Analyze my umami website stats for the last week and provide a full analysis report";

const withIterations = (maxIterations: number) => ({
  ...defaultReasoningConfig,
  strategies: {
    ...defaultReasoningConfig.strategies,
    reactive: { ...defaultReasoningConfig.strategies.reactive, maxIterations },
  },
});

const SCHEMAS = [
  { name: "umami/list_websites", description: "Lists websites.", parameters: [{ name: "search", type: "string", description: "filter", required: false }] },
  { name: "umami/get_website_stats", description: "Website totals.", parameters: [{ name: "websiteId", type: "string", description: "id", required: true }] },
];

/** The MCP text results, as the traces received them (JSON text). */
const SITES = { websites: [{ id: "site-1", name: "Docs Site", domain: "docs.example.dev" }], page: 1, pageSize: 20, count: 1 };
const STATS = { websiteId: "site-1", current: { pageviews: 678, visitors: 478 } };

const toolReply = (name: string, sites: unknown = SITES) =>
  Effect.succeed({ success: true, result: JSON.stringify(name === "umami/list_websites" ? sites : STATS) });

const fence = (body: string) => "```javascript\n" + body + "\n```";

/** Trace A, attempt 1: guesses `websites[0].websiteId` on the `{ websites }` object. */
const GUESS_CODE = fence(`(async () => {
  const websites = await umami_list_websites();
  const websiteId = websites[0].websiteId;
  return await umami_get_website_stats({ websiteId });
})()`);
/** Trace A, attempt 2 without shapes: the next blind guess (`.results`). */
const BLIND_CODE = fence(`(async () => {
  const r = await umami_list_websites();
  const websiteId = r.results[0].id;
  return await umami_get_website_stats({ websiteId });
})()`);
/** Code that reads the real shape. */
const GOOD_CODE = fence(`(async () => {
  const { websites } = await umami_list_websites();
  const stats = await umami_get_website_stats({ websiteId: websites[0].id });
  return { site: websites[0].name, stats };
})()`);
/** Trace C: a guarded wrong read that returns a nothing-found string. */
const FALSE_EMPTY_CODE = fence(`(async () => {
  const websites = await umami_list_websites();
  const websiteId = websites[0]?.websiteId;
  if (!websiteId) return "No website available for analysis.";
  return await umami_get_website_stats({ websiteId });
})()`);

const REPORT = "# Weekly analytics report\n\nDocs Site had 678 pageviews from 478 visitors.";
/** The synthesis prompt (output-synthesis.ts buildSynthesisPrompt) carries this line. */
const SYNTH: TestTurn = { match: "raw data gathered by tools", text: REPORT };

const run = (scenario: readonly TestTurn[], opts: { maxIterations?: number; task?: string; sites?: unknown } = {}) => {
  const layer = mockToolServiceLayer({
    execute: (req: { toolName: string }) => toolReply(req.toolName, opts.sites),
    getTool: (name: string) => Effect.succeed({ name, description: "t", parameters: [] }),
    register: () => Effect.void,
    listTools: () => Effect.succeed([]),
    deregister: () => Effect.void,
  }) as Layer.Layer<ToolService>;
  const program = executeCodeAction({
    taskDescription: opts.task ?? TASK,
    taskType: "analysis",
    memoryContext: "",
    availableTools: SCHEMAS.map((s) => s.name),
    availableToolSchemas: SCHEMAS,
    config: withIterations(opts.maxIterations ?? 3),
  }).pipe(Effect.provide(Layer.merge(TestLLMServiceLayer([...scenario]), layer)));
  return Effect.runPromise(provideTestEnvelope(program, buildRunEnvelope({})));
};

const meta = (result: { readonly metadata: unknown }, key: string): unknown =>
  typeof result.metadata === "object" && result.metadata !== null ? Reflect.get(result.metadata, key) : undefined;

describe("result shapes — pure", () => {
  it("renders key names and types, arrays by first element and count, no values", () => {
    expect(describeValueShape(SITES)).toBe(
      "{ websites: [{ id: string, name: string, domain: string }] (1 item), page: number, pageSize: number, count: number }",
    );
    expect(describeValueShape(SITES)).not.toContain("Docs Site");
    expect(describeValueShape([])).toBe("[]");
    expect(describeValueShape(null)).toBe("null");
    expect(describeValueShape({ a: { b: { c: { d: 1 } } } })).toBe("{ a: { b: { c: object } } }");
  });

  it("is bounded: many keys are counted, long shapes truncated, repeated calls shown once", () => {
    const wide = Object.fromEntries(Array.from({ length: 14 }, (_, i) => [`k${i}`, i]));
    expect(describeValueShape(wide)).toContain("...+4 keys");
    const long = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`aVeryLongPropertyName${i}`, { nested: "x", other: 1 }]));
    expect(describeValueShape(long).length).toBeLessThanOrEqual(363);
    const call = { fnName: "f", toolName: "f", args: {}, result: SITES };
    expect(formatResultShapes([call, call, call]).split("\n")).toHaveLength(1);
  });
});

describe("false-empty rule — pure", () => {
  const evidence = [{ name: "umami_list_websites", result: SITES }];

  it("names a nothing-found claim the tool data contradicts", () => {
    expect(contradictedEmptyAnswer("No website available for analysis.", evidence)).toEqual({
      answer: JSON.stringify("No website available for analysis."),
      contradictedBy: "umami_list_websites",
    });
    expect(contradictedEmptyAnswer("No data found.", evidence)?.contradictedBy).toBe("umami_list_websites");
    expect(contradictedEmptyAnswer(null, evidence)?.answer).toBe("null");
    expect(contradictedEmptyAnswer([], evidence)?.answer).toBe("[]");
  });

  it("negative controls: no data, an unrelated claim, a real answer, a long text", () => {
    expect(contradictedEmptyAnswer("No websites found.", [{ name: "umami_list_websites", result: { websites: [], count: 0 } }])).toBeUndefined();
    expect(contradictedEmptyAnswer("No broken links found.", evidence)).toBeUndefined();
    expect(contradictedEmptyAnswer("Docs Site: 678 pageviews", evidence)).toBeUndefined();
    expect(contradictedEmptyAnswer({ site: "Docs Site" }, evidence)).toBeUndefined();
    expect(isNothingFoundClaim(`No website issues. ${"x".repeat(300)}`)).toBe(false);
    expect(carriesData({ total: 5 })).toBe(false);
    expect(carriesData("No results.")).toBe(false);
    expect(carriesData("some text")).toBe(true);
  });
});

describe("answer plan — pure", () => {
  it("structured results get an answer call; JSON/CSV tasks and plain text do not", () => {
    expect(planCodeActionAnswer({ a: 1 }, '{"a":1}', TASK).synthesize).toBe(true);
    expect(planCodeActionAnswer([1], "[1]", "list them").synthesize).toBe(true);
    expect(planCodeActionAnswer({ a: 1 }, '{"a":1}', "Return the stats as JSON").synthesize).toBe(false);
    expect(planCodeActionAnswer("5", "5", "add 2 and 3").synthesize).toBe(false);
    const big = "x".repeat(20_000);
    expect(planCodeActionAnswer({ big }, big, TASK).material.length).toBeLessThan(16_200);
  });
});

describe("code-action — trace 01M7T7A58VBP4CHMSJPKQ516SR (A: result shapes in the repair prompt)", () => {
  it("the repair after a wrong guess sees the real shape and completes on attempt 2", async () => {
    // The good code is only reachable when the repair prompt shows the shape.
    const result = await run([
      { text: GUESS_CODE },
      { match: "websites: \\[\\{ id: string", text: GOOD_CODE },
      SYNTH,
      { text: BLIND_CODE },
    ]);
    expect(result.status).toBe("completed");
    expect(meta(result, "iterations")).toBe(2);
  }, 20000);
});

describe("code-action — traces 01M7T7A58 / 01M7T7C5 (B: the answer is written, not the raw return)", () => {
  it("a structured program result becomes a model-written report through one synthesis call", async () => {
    const result = await run([{ text: GOOD_CODE }, SYNTH]);
    expect(result.status).toBe("completed");
    expect(result.output).toBe(REPORT);
    expect(meta(result, "answerSynthesized")).toBe(true);
    expect(meta(result, "llmCalls")).toBe(2);
    expect(result.steps.some((s) => s.content.startsWith("[CODE-ACTION] Answer written from the program result"))).toBe(true);
  }, 20000);

  it("a task that asks for JSON keeps the raw program result (no synthesis call)", async () => {
    const result = await run([{ text: GOOD_CODE }, SYNTH], { task: "Return my umami website stats as JSON" });
    expect(result.status).toBe("completed");
    expect(JSON.parse(result.output ?? "")).toEqual({ site: "Docs Site", stats: STATS });
    expect(meta(result, "answerSynthesized")).toBe(false);
    expect(meta(result, "llmCalls")).toBe(1);
  }, 20000);
});

describe("code-action — trace 01M7T7BJMFHVT2PCHNYWMG9S4P (C: nothing found vs the run's own data)", () => {
  it("at the cap: failed, the contradiction named", async () => {
    const result = await run([{ text: FALSE_EMPTY_CODE }], { maxIterations: 1 });
    expect(result.status).toBe("failed");
    expect(String(result.error)).toContain("No website available for analysis.");
    expect(String(result.error)).toContain("umami_list_websites returned data");
  }, 20000);

  it("with iterations left: the retry states the contradiction and the shape, and the repaired code completes", async () => {
    const result = await run([
      { text: FALSE_EMPTY_CODE },
      { match: "nothing found\\), but umami_list_websites returned data[\\s\\S]*websites: \\[\\{ id: string", text: GOOD_CODE },
      SYNTH,
    ]);
    expect(result.status).toBe("completed");
    expect(result.output).toBe(REPORT);
    expect(meta(result, "iterations")).toBe(2);
  }, 20000);

  it("negative control: the same answer when the tool really returned no websites completes", async () => {
    const result = await run([{ text: FALSE_EMPTY_CODE }], { maxIterations: 1, sites: { websites: [], count: 0 } });
    expect(result.status).toBe("completed");
    expect(result.output).toBe("No website available for analysis.");
  }, 20000);
});
