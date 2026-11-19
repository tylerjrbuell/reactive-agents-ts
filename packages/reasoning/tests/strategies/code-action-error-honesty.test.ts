// Run: bun test packages/reasoning/tests/strategies/code-action-error-honesty.test.ts --timeout 20000
//
// Cortex trace 01M7T338WQJ4TV6Z6M6T3SNHHP (2026-11-19, gemini-flash-latest,
// code-action): `umami/list_websites` SUCCEEDED, but an MCP tool's text result
// reached the generated code as a JSON *string*. The code read
// `res?.websites` off that string, got undefined, and returned
// `{ error: "No websites found for the authenticated account." }`. code-action
// shipped that object as a `completed` answer (noopVerifier, 0/0 conditions,
// authority model-final): a false success.
//
// Pinned here (strategies/code-action/sandbox-tool-result.ts + its wiring):
//   - a JSON-text tool result reaches the code decoded (the trace replay
//     finds the website and completes);
//   - a result that is only `{ error }` is not an answer: a FAIL verdict
//     (retried while iterations remain), `failed` with the error named at the cap;
//   - a tool output with `success: false` throws into the code, never resolves quietly;
//   - every tool call failing is not an answer either;
//   - the plan prompt says tool results arrive parsed (no JSON.parse), and code
//     that JSON.parses one anyway fails once and is fixed by the repair turn;
//   - negative controls: plain-text results stay strings, a normal object
//     answer completes.
//
// RED-ON-CUT: return the raw `output.result` from the handler (the trace pin
// fails), drop the error-shape check (the `{ error }` pins complete), drop the
// `success === false` throw (the quiet-failure pin completes).
import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import type { ToolService } from "@reactive-agents/tools";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { mockToolServiceLayer } from "../../src/testing/tool-service-mock.js";
import { executeCodeAction } from "../../src/strategies/code-action.js";
import { decodeSandboxToolResult, errorShapedResult } from "../../src/strategies/code-action/sandbox-tool-result.js";
import { buildPlanPrompt } from "../../src/strategies/code-action/code-action-plan.js";
import { defaultReasoningConfig } from "../../src/types/config.js";
import { provideTestEnvelope, buildRunEnvelope } from "../../src/kernel/envelope/run-envelope.js";

const withIterations = (maxIterations: number) => ({
  ...defaultReasoningConfig,
  strategies: {
    ...defaultReasoningConfig.strategies,
    reactive: { ...defaultReasoningConfig.strategies.reactive, maxIterations },
  },
});

const LIST_SCHEMA = {
  name: "umami/list_websites",
  description: "Lists the websites the authenticated user can access.",
  parameters: [{ name: "search", type: "string", description: "filter", required: false }],
};

/** The MCP text result from the trace: pretty-printed JSON text, not an object. */
const WEBSITES_TEXT = JSON.stringify(
  { websites: [{ id: "4d58acb5", name: "Reactive Agents Documentation", domain: "docs.reactiveagents.dev" }] },
  null,
  2,
);

const fence = (body: string) => "```javascript\n" + body + "\n```";

/** The trace's code, trimmed to the part that decided the outcome. */
const TRACE_CODE = fence(`(async () => {
  const websitesRes = await umami_list_websites();
  const websites = websitesRes?.data || websitesRes?.websites || (Array.isArray(websitesRes) ? websitesRes : []);
  if (!websites || websites.length === 0) {
    return { error: "No websites found for the authenticated account." };
  }
  return { summary: "Analysis of " + websites.length + " website(s)", names: websites.map((w) => w.name) };
})()`);

const ERROR_CODE = fence(`(async () => { await umami_list_websites(); return { error: "No websites found for the authenticated account." }; })()`);

type ToolReply = { readonly success: boolean; readonly result: unknown; readonly error?: string };

const run = (scenario: readonly string[], reply: ToolReply, maxIterations = 1) => {
  const layer = mockToolServiceLayer({
    execute: () => Effect.succeed(reply),
    getTool: (name: string) => Effect.succeed({ name, description: "t", parameters: [] }),
    register: () => Effect.void,
    listTools: () => Effect.succeed([]),
    deregister: () => Effect.void,
  }) as Layer.Layer<ToolService>;
  const program = executeCodeAction({
    taskDescription: "Analyze my umami website stats for the last 5 days and report",
    taskType: "simple",
    memoryContext: "",
    availableTools: [LIST_SCHEMA.name],
    availableToolSchemas: [LIST_SCHEMA],
    config: withIterations(maxIterations),
  }).pipe(Effect.provide(Layer.merge(TestLLMServiceLayer(scenario.map((text) => ({ text }))), layer)));
  return Effect.runPromise(provideTestEnvelope(program, buildRunEnvelope({})));
};

describe("sandbox tool results — pure", () => {
  it("JSON object/array text decodes; anything else stays as it was", () => {
    expect(decodeSandboxToolResult(WEBSITES_TEXT)).toEqual(JSON.parse(WEBSITES_TEXT));
    expect(decodeSandboxToolResult(" [1, 2] ")).toEqual([1, 2]);
    expect(decodeSandboxToolResult("sites: a, b")).toBe("sites: a, b");
    expect(decodeSandboxToolResult("42")).toBe("42");
    expect(decodeSandboxToolResult("{not json")).toBe("{not json");
    const obj = { a: 1 };
    expect(decodeSandboxToolResult(obj)).toBe(obj);
  });

  it("errorShapedResult names an object whose only field is `error`", () => {
    expect(errorShapedResult({ error: "boom" })).toBe("boom");
    expect(errorShapedResult({ error: { code: 7 } })).toBe('{"code":7}');
    expect(errorShapedResult({ error: "boom", partialData: [1] })).toBeUndefined();
    expect(errorShapedResult({ error: "" })).toBeUndefined();
    expect(errorShapedResult("error: boom")).toBeUndefined();
    expect(errorShapedResult([{ error: "boom" }])).toBeUndefined();
    expect(errorShapedResult(null)).toBeUndefined();
  });
});

describe("code-action prompt — tool results arrive parsed", () => {
  it("the system prompt tells the model results are parsed and must not be JSON.parse'd", () => {
    const { system } = buildPlanPrompt("task", "declare async function t(): Promise<unknown>;");
    expect(system).toContain("parsed");
    expect(system).toContain("JSON.parse");
  });
});

describe("code-action — trace 01M7T338WQJ4TV6Z6M6T3SNHHP", () => {
  it("a JSON-text MCP result reaches the code decoded: the website is found and the run completes", async () => {
    const result = await run([TRACE_CODE], { success: true, result: WEBSITES_TEXT });
    expect(result.status).toBe("completed");
    expect(result.output).toContain("Reactive Agents Documentation");
    expect(result.output).not.toContain("No websites found");
  }, 20000);

  it("code that returns only `{ error }` is not an answer: failed at the cap, the error named", async () => {
    const result = await run([ERROR_CODE], { success: true, result: WEBSITES_TEXT });
    expect(result.status).toBe("failed");
    expect(String(result.error)).toContain("No websites found for the authenticated account.");
  }, 20000);

  it("an error result with iterations left is retried, and a real answer then completes", async () => {
    const result = await run([ERROR_CODE, TRACE_CODE], { success: true, result: WEBSITES_TEXT }, 3);
    expect(result.status).toBe("completed");
    expect(result.output).toContain("Reactive Agents Documentation");
    expect(result.steps.some((s) => s.content.includes("returned an error instead of an answer"))).toBe(true);
  }, 20000);

  it("a tool output with success:false throws into the code instead of resolving quietly", async () => {
    const code = fence(`(async () => { try { return await umami_list_websites(); } catch (e) { return "caught: " + e.message; } })()`);
    const result = await run([code], { success: false, result: undefined, error: "401 unauthorized" });
    expect(result.status).toBe("failed");
    expect(String(result.error)).toContain("401 unauthorized");
    expect(result.output ?? "").not.toBe("undefined");
  }, 20000);

  it("code that JSON.parses an already-decoded result fails once, then the repair turn's code completes", async () => {
    const parseCode = fence(`(async () => { const r = JSON.parse(await umami_list_websites()); return { names: r.websites.map((w) => w.name) }; })()`);
    const result = await run([parseCode, TRACE_CODE], { success: true, result: WEBSITES_TEXT }, 3);
    expect(result.status).toBe("completed");
    expect(result.output).toContain("Reactive Agents Documentation");
    // The first code threw on JSON.parse of an object: a sandbox failure the repair turn fixed.
    expect(result.steps.some((s) => s.content.startsWith("[CODE-ACTION] Sandbox execution failed:"))).toBe(true);
  }, 20000);

  it("negative control: a plain-text tool result stays a string and completes", async () => {
    const code = fence(`(async () => { const r = await umami_list_websites(); return typeof r + ": " + r; })()`);
    const result = await run([code], { success: true, result: "sites: a, b" });
    expect(result.status).toBe("completed");
    expect(result.output).toBe("string: sites: a, b");
  }, 20000);
});
