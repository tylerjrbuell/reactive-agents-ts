// Run: bun test packages/reasoning/tests/strategies/code-action-tool-args.test.ts --timeout 20000
//
// Cortex run 01M7SZFGGV6W2K8R4V2H873NPM (2026-11-19): the model wrote
// `await umami_list_websites()` for a tool whose parameters are all optional.
// The sandbox handler passed `args = undefined` straight into
// `ToolService.execute`, which died on `Object.keys(args)`; the identical
// error then repeated on all 10 iterations. These pins cover the three
// halves of the fix: argument shaping at the sandbox handler, the prompt and
// bindings showing zero-argument usage, and an early stop on a repeated
// identical sandbox failure.
import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import type { ToolService } from "@reactive-agents/tools";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { mockToolServiceLayer } from "../../src/testing/tool-service-mock.js";
import { executeCodeAction } from "../../src/strategies/code-action.js";
import { shapeSandboxToolArgs } from "../../src/strategies/code-action/tool-args.js";
import { generateToolBindings } from "../../src/strategies/code-action/tool-binding.js";
import { buildPlanPrompt } from "../../src/strategies/code-action/code-action-plan.js";
import { isRepeatedSandboxFailure } from "../../src/strategies/code-action/code-action-reflect.js";
import { defaultReasoningConfig } from "../../src/types/config.js";
import { provideTestEnvelope, buildRunEnvelope } from "../../src/kernel/envelope/run-envelope.js";

const withIterations = (maxIterations: number) => ({
  ...defaultReasoningConfig,
  strategies: {
    ...defaultReasoningConfig.strategies,
    reactive: { ...defaultReasoningConfig.strategies.reactive, maxIterations },
  },
});

const SEARCH_SCHEMA = {
  name: "list-sites",
  description: "list sites",
  parameters: [{ name: "search", type: "string", description: "filter", required: false }],
};

const fence = (body: string) => "```javascript\n" + body + "\n```";

function recordingToolLayer() {
  const calls: { toolName: string; arguments: unknown }[] = [];
  const layer = mockToolServiceLayer({
    execute: (req: { toolName: string; arguments: unknown }) =>
      Effect.sync(() => {
        calls.push({ toolName: req.toolName, arguments: req.arguments });
        return { success: true, result: "sites: a, b" };
      }),
    getTool: (name: string) => Effect.succeed({ name, description: "t", parameters: [] }),
    register: () => Effect.void,
    listTools: () => Effect.succeed([]),
    deregister: () => Effect.void,
  });
  return { layer: layer as Layer.Layer<ToolService>, calls };
}

const runStrategy = (scenario: readonly string[], maxIterations = 1) => {
  const { layer, calls } = recordingToolLayer();
  const program = executeCodeAction({
    taskDescription: "list the sites",
    taskType: "simple",
    memoryContext: "",
    availableTools: ["list-sites"],
    availableToolSchemas: [SEARCH_SCHEMA],
    config: withIterations(maxIterations),
  }).pipe(Effect.provide(Layer.merge(TestLLMServiceLayer(scenario.map((text) => ({ text }))), layer)));
  return Effect.runPromise(provideTestEnvelope(program, buildRunEnvelope({}))).then((result) => ({ result, calls }));
};

describe("shapeSandboxToolArgs — pure", () => {
  it("undefined and null become {}", () => {
    expect(shapeSandboxToolArgs(undefined, "t")).toEqual({ args: {} });
    expect(shapeSandboxToolArgs(null, "t")).toEqual({ args: {} });
  });

  it("an object passes through unchanged", () => {
    expect(shapeSandboxToolArgs({ a: 1 }, "t")).toEqual({ args: { a: 1 } });
  });

  it("a string or array is rejected with the actionable message", () => {
    for (const bad of ["x", [1], 3, true]) {
      const shaped = shapeSandboxToolArgs(bad, "list_sites", "search");
      expect(shaped.error).toStartWith("list_sites takes one object argument, e.g. list_sites({ search: value })");
    }
  });

  it("a tool with no parameters shows the empty-object example", () => {
    expect(shapeSandboxToolArgs("x", "ping").error).toStartWith("ping takes one object argument, e.g. ping({})");
  });
});

describe("code-action — sandbox tool arguments", () => {
  it("tool() reaches ToolService as {}", async () => {
    const { result, calls } = await runStrategy([fence("(async () => { return await list_sites(); })()")]);
    expect(calls).toEqual([{ toolName: "list-sites", arguments: {} }]);
    expect(result.status).toBe("completed");
    expect(result.output).toBe("sites: a, b");
  }, 20000);

  it("tool(null) reaches ToolService as {}", async () => {
    const { calls } = await runStrategy([fence("(async () => { return await list_sites(null); })()")]);
    expect(calls).toEqual([{ toolName: "list-sites", arguments: {} }]);
  }, 20000);

  it("tool('x') and tool([1]) throw the actionable message into generated code; the tool never runs", async () => {
    const code = fence(
      "(async () => { const out = []; for (const a of ['x', [1]]) { try { await list_sites(a); } catch (e) { out.push(e.message); } } return out.join(' | '); })()",
    );
    const { result, calls } = await runStrategy([code]);
    expect(calls).toEqual([]);
    const parts = String(result.output).split(" | ");
    expect(parts).toHaveLength(2);
    for (const p of parts) {
      expect(p).toStartWith("list_sites takes one object argument, e.g. list_sites({ search: value })");
    }
  }, 20000);
});

describe("code-action — prompt and bindings show zero-argument usage", () => {
  it("a tool with no required parameters is declared with an optional params object", () => {
    const b = generateToolBindings([
      { name: "list-sites", description: "d", parameters: { type: "object", properties: { search: { type: "string" } } } },
      { name: "get", description: "d", parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
    ]);
    expect(b).toContain("declare async function list_sites(params?: { search?: string }): Promise<unknown>;");
    expect(b).toContain("declare async function get(params: { id: string }): Promise<unknown>;");
  });

  it("the system prompt says zero-arg tools may be called as tool() or tool({})", () => {
    const { system } = buildPlanPrompt("task", "declare async function x(params?: {  }): Promise<unknown>;");
    expect(system).toContain("one object argument");
    expect(system).toContain("`tool()` or `tool({})`");
  });
});

describe("code-action — repeated identical sandbox failure stops early", () => {
  it("isRepeatedSandboxFailure: same message twice in a row only", () => {
    expect(isRepeatedSandboxFailure(null, "boom")).toBe(false);
    expect(isRepeatedSandboxFailure("boom", "boom")).toBe(true);
    expect(isRepeatedSandboxFailure("boom", "bang")).toBe(false);
  });

  it("the same failing code stops after 2 identical sandbox errors with status failed and the error named", async () => {
    const { result } = await runStrategy([fence("(async () => { throw 'same-sandbox-failure'; })()")], 10);
    const failures = result.steps.filter((s) => s.content.startsWith("[CODE-ACTION] Sandbox execution failed"));
    expect(failures).toHaveLength(2);
    expect(result.status).toBe("failed");
    expect(String(result.error)).toContain("same-sandbox-failure");
    expect(String(result.error)).toContain("repeated");
  }, 20000);

  it("negative control: different failures keep retrying and a later success completes", async () => {
    const { result } = await runStrategy(
      [
        fence("(async () => { throw 'first-failure'; })()"),
        fence("(async () => { throw 'second-failure'; })()"),
        fence("(async () => { return await list_sites({}); })()"),
      ],
      10,
    );
    const failures = result.steps.filter((s) => s.content.startsWith("[CODE-ACTION] Sandbox execution failed"));
    expect(failures).toHaveLength(2);
    expect(result.status).toBe("completed");
    expect(result.output).toBe("sites: a, b");
  }, 20000);
});
