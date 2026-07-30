// Run: bun test packages/reasoning/tests/strategies/code-action-subagent-ledger.test.ts --timeout 20000
//
// Root cause #7 (2026-07-29 systems audit): code-action was the one delegation
// path Wave C.2's sub-agent ledger merge never wired through. Its sandbox
// dispatches tools via a Worker closure (not the kernel act primitive), so it
// needs its own copy of the extract-for-merge / strip-for-display pattern the
// other 3 paths (act.ts, inline-act.ts, plan-execute/blueprint via
// executeToolAndObserve) already carry.
//
// Two properties pinned here:
//   1. MERGE — a spawn-agent's childRunLedger reaches result.metadata.runLedger
//      under its `sub-agent:<name>` stamp, same as every other strategy.
//   2. NO LEAK — the raw ledger array never appears in the model-visible
//      observation text (code-action's retry/verifier prompt), only the
//      stripped display shape does.
//
// RED-ON-CUT: drop `childRunLedgerOf`/`subAgentResultForDisplay` wiring from
// code-action.ts or code-action-observe.ts and (1) fails silently (ledger
// entry vanishes) while (2) fails loudly (raw ledger substring reappears).
import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { LLMService, TestLLMService } from "@reactive-agents/llm-provider";
import { ToolService } from "@reactive-agents/tools";
import { executeCodeAction } from "../../src/strategies/code-action.js";
import { defaultReasoningConfig } from "../../src/types/config.js";
import { provideTestEnvelope } from "../../src/kernel/envelope/run-envelope.js";
import type { ReasoningResult } from "../../src/types/index.js";

const TASK = "Delegate the leaf work to a sub-agent and report its result.";

const SPAWN_AGENT_SCHEMA = {
  name: "spawn-agent",
  description: "Delegate to a sub-agent",
  parameters: [
    { name: "task", type: "string", description: "task", required: true },
    { name: "name", type: "string", description: "sub-agent name", required: true },
  ],
};

// A fake SubAgentResult carrying a childRunLedger, exactly what
// sub-agent-executor.ts hands back on a real spawn-agent call.
const CHILD_RESULT = {
  subAgentName: "child-one",
  success: true,
  summary: "leaf work done",
  tokensUsed: 42,
  childRunLedger: [
    {
      seq: 0,
      iteration: 1,
      pass: "sub-agent:child-one",
      kind: "tool-invocation",
      toolName: "leaf-tool",
      args: { secret: "child-arg-marker" },
    },
    {
      seq: 1,
      iteration: 1,
      pass: "sub-agent:child-one",
      kind: "tool-result",
      toolName: "leaf-tool",
      success: true,
      preview: "leaf-tool-result-marker",
    },
  ],
};

function makeToolLayer() {
  return Layer.succeed(
    ToolService,
    ToolService.of({
      execute: () => Effect.succeed({ success: true, result: CHILD_RESULT }),
      getTool: (name: string) =>
        Effect.succeed({ name, description: "test tool", parameters: SPAWN_AGENT_SCHEMA.parameters }),
      register: () => Effect.void,
      listTools: () => Effect.succeed([]),
      deregister: () => Effect.void,
    } as unknown as Parameters<typeof ToolService.of>[0]),
  );
}

describe("code-action: sub-agent ledger merge + no raw-ledger leak", () => {
  it("merges the child's ledger under sub-agent:child-one and never leaks it into model-visible text", async () => {
    const code = [
      "```javascript",
      '(async () => { const r = await spawn_agent({ task: "leaf work", name: "child-one" }); return "delegated: " + r.summary; })()',
      "```",
    ].join("\n");

    const result = (await Effect.runPromise(
      provideTestEnvelope(
        executeCodeAction({
          taskDescription: TASK,
          taskType: "general",
          memoryContext: "",
          availableTools: ["spawn-agent"],
          availableToolSchemas: [SPAWN_AGENT_SCHEMA],
          config: defaultReasoningConfig,
        } as never).pipe(
          Effect.provide(
            Layer.mergeAll(
              Layer.succeed(LLMService, LLMService.of(TestLLMService([{ text: code }]))),
              makeToolLayer(),
            ),
          ),
        ),
      ),
    )) as ReasoningResult;

    // Property 1 — MERGE: the child's ledger reached the parent's runLedger.
    const md = result.metadata as { runLedger?: ReadonlyArray<{ pass?: string }> };
    const ledger = md.runLedger ?? [];
    expect(ledger.some((e) => e.pass === "sub-agent:child-one")).toBe(true);

    // Property 2 — NO LEAK: neither the recorded observation steps' content
    // nor the strategy's final output string contains the child's raw args/
    // preview markers — only through the stripped display shape.
    const observationText = result.steps
      .filter((s) => s.type === "observation")
      .map((s) => s.content)
      .join("\n");
    expect(observationText).not.toContain("child-arg-marker");
    expect(observationText).not.toContain("leaf-tool-result-marker");
    expect(observationText).not.toContain("childRunLedger");
    expect(String(result.output ?? "")).not.toContain("childRunLedger");
  }, 20000);
});
