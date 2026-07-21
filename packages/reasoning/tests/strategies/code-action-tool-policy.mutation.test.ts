// Run: bun test packages/reasoning/tests/strategies/code-action-tool-policy.mutation.test.ts --timeout 15000
//
// P0-4 residual (Wave 2 B1 follow-up) — code-action executes tools inside the
// sandbox Worker via bridged handler closures, NOT through the kernel act phase
// or the canonical `executeToolAndObserve` primitive. Before this gate, those
// closures called `toolSvc.execute()` with ZERO policy checks: LLM-generated
// code could execute a contract-forbidden tool on the one strategy the B1
// boundary didn't cover.
//
// Mutation contract (red-on-cut): remove the `evaluateToolPolicy` call from the
// handler closure in `code-action.ts` and the "forbidden tool is NEVER executed"
// assertions below go red — the mock ToolService records an execution.

import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { ToolService } from "@reactive-agents/tools";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { executeCodeAction } from "../../src/strategies/code-action.js";
import { defaultReasoningConfig } from "../../src/types/config.js";

const TOOL_SCHEMA = {
  name: "search",
  description: "Search the web",
  parameters: [{ name: "query", type: "string", description: "query", required: true }],
};

// The plan LLM returns a code block that calls the bound `search` tool.
const CODE_CALLING_SEARCH =
  "```typescript\n(async () => { return await search({ query: 'x' }); })()\n```";

// Cap at 1 iteration so a blocked (failing) run terminates deterministically.
const oneIterationConfig = {
  ...defaultReasoningConfig,
  strategies: {
    ...defaultReasoningConfig.strategies,
    reactive: {
      ...defaultReasoningConfig.strategies.reactive,
      maxIterations: 1,
    },
  },
};

/** Recording ToolService — counts every execute() that actually reaches it. */
function recordingToolLayer() {
  const executed: string[] = [];
  const layer = Layer.succeed(
    ToolService,
    ToolService.of({
      execute: (req: { toolName: string }) =>
        Effect.sync(() => {
          executed.push(req.toolName);
          return { success: true, result: { ok: true } };
        }),
      getTool: (name: string) =>
        Effect.succeed({
          name,
          description: "t",
          parameters: [{ name: "query", type: "string", required: true }],
        }),
      register: () => Effect.void,
      listTools: () => Effect.succeed([]),
      deregister: () => Effect.void,
    } as unknown as Parameters<typeof ToolService.of>[0]),
  );
  return { layer, executed };
}

const runCodeAction = (
  extra: Record<string, unknown>,
  toolLayer: Layer.Layer<ToolService>,
) =>
  Effect.runPromise(
    executeCodeAction({
      taskDescription: "search and finish",
      taskType: "simple",
      memoryContext: "",
      availableTools: ["search"],
      availableToolSchemas: [TOOL_SCHEMA],
      config: oneIterationConfig,
      ...extra,
    } as never).pipe(
      Effect.provide(
        Layer.merge(TestLLMServiceLayer([{ text: CODE_CALLING_SEARCH }]), toolLayer),
      ),
    ),
  );

describe("code-action tool-policy gate (P0-4 residual) — sandbox handlers enforce the contract", () => {
  it("forbiddenTools: the tool is NEVER executed and the policy message surfaces", async () => {
    const { layer, executed } = recordingToolLayer();
    const result = await runCodeAction({ forbiddenTools: ["search"] }, layer);

    // The safety property: the forbidden tool never reached ToolService.
    expect(executed).toEqual([]);
    // The block is honest — the kernel-path policy message appears in the trace.
    const trace = result.steps.map((s) => s.content).join("\n");
    expect(trace).toContain('forbidden by contract');
  }, 15000);

  it("taskContract deny-list seeds the gate (production .withContract signal)", async () => {
    const { layer, executed } = recordingToolLayer();
    await runCodeAction(
      {
        taskContract: {
          tools: [{ name: "search", kind: "forbidden" }],
        },
      },
      layer,
    );
    expect(executed).toEqual([]);
  }, 15000);

  it("allowedTools whitelist: a tool outside the list is blocked", async () => {
    const { layer, executed } = recordingToolLayer();
    await runCodeAction({ allowedTools: ["other-tool"] }, layer);
    expect(executed).toEqual([]);
  }, 15000);

  it("CONTROL: with no policy the tool executes exactly as before", async () => {
    const { layer, executed } = recordingToolLayer();
    const result = await runCodeAction({}, layer);
    expect(executed).toEqual(["search"]);
    expect(result.status).toBe("completed");
  }, 15000);

  it("CONTROL: an allowedTools list that includes the tool permits it", async () => {
    const { layer, executed } = recordingToolLayer();
    await runCodeAction({ allowedTools: ["search"] }, layer);
    expect(executed).toEqual(["search"]);
  }, 15000);
});
