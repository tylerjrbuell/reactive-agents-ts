// Run: bun test packages/reasoning/src/kernel/loop/scaffold-leak-terminal-repair.test.ts --timeout 20000
//
// Live incident (taskId 01M3T04DXBYSYMXTRPSH57AT93):
//
//   ExecutionError "Verifier rejected output: final-answer: failed at
//   scaffold-leak (output contains framework scaffolding markers ...)".
//   The model's terminal text echoed harness scaffolding (`_tool_result_1`,
//   "[STORED:]", "full text is stored") instead of the tool data. The
//   always-on guard rejected it and the terminal gate HARD-FAILED the entire
//   run, zero repair attempts, even though the real answer ("XRP price:
//   $0.50") sat in the validated observations the whole time.
//
// Why no existing retry caught it: native-FC runs never offer the
// `final-answer` meta-tool, so the arbitrator's `synthesisQualityRetry`
// (text-protocol intents only) was unreachable, and `enforceQualityGate`
// only guards reflexion/plan-execute terminals.
//
// Contract: a model-authored terminal scaffold-leak gets exactly ONE
// corrective synthesis pass from the scratchpad-resolved observations
// (DATA→FORMAT, mirroring Phase D1's cap-then-degrade). Clean after repair →
// ship. Still leaking after repair → the honest hard-fail remains, with the
// scaffold-leak reason preserved on the error.

import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { succeedingToolLayer } from "../../testing/tool-service-mock.js";
import { reactKernel } from "./react-kernel.js";
import { runPass } from "./run-pass.js";
import type { KernelInput } from "../state/kernel-state.js";
import type { ToolSchema } from "../capabilities/attend/tool-formatting.js";

const PRICE_SCHEMA: ToolSchema = {
  name: "bench_price",
  description: "look up a crypto price",
  parameters: [{ name: "symbol", type: "string", required: true }],
};

// Short (< 20 chars) so the arbitrator's synthesisQualityRetry can never
// fire even on the text-protocol path, the runner's terminal repair must be
// what resolves this run, deterministically.
const TOOL_RESULT = "XRP price: $0.50";

const LEAKED_ANSWER =
  "The data is in _tool_result_1, full text is stored, use recall(\"_tool_result_1\") to read it.";

const input: KernelInput = {
  task: "Use the bench_price tool to look up the XRP price and report it.",
  availableToolSchemas: [PRICE_SCHEMA],
  allToolSchemas: [PRICE_SCHEMA],
};

const runOpts = {
  maxIterations: 4,
  strategy: "reactive",
  kernelType: "react",
  taskId: "scaffold-leak-terminal-repair",
} as const;

describe("terminal scaffold-leak repair (Phase D2)", () => {
  it("leaked terminal answer is re-synthesized from tool data and ships", async () => {
    const scenario = [
      { toolCall: { name: "bench_price", args: { symbol: "XRP" } } },
      { text: LEAKED_ANSWER },
      // Harness channel (purpose "synthesize"), the ONE repair call.
      { text: TOOL_RESULT },
    ];

    const result = await Effect.runPromise(
      runPass(reactKernel, input, runOpts).pipe(
        Effect.provide(
          Layer.mergeAll(
            TestLLMServiceLayer(scenario),
            succeedingToolLayer(TOOL_RESULT),
          ),
        ),
      ),
    );

    expect(result.state.status).toBe("done");
    expect(result.output).toBe(TOOL_RESULT);
    // The leaked text must NOT be what ships.
    expect(result.output).not.toContain("_tool_result_");
    expect(result.output).not.toContain("full text is stored");
  });

  it("still-leaking repair output keeps the honest hard-fail with the scaffold-leak reason", async () => {
    const scenario = [
      { toolCall: { name: "bench_price", args: { symbol: "XRP" } } },
      { text: LEAKED_ANSWER },
      // The repair pass echoes scaffolding again, bounded at ONE attempt,
      // the guard must not be weakened.
      { text: "See [STORED: _tool_result_1] for the values." },
    ];

    const result = await Effect.runPromise(
      runPass(reactKernel, input, {
        ...runOpts,
        taskId: "scaffold-leak-terminal-repair-still-leaking",
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            TestLLMServiceLayer(scenario),
            succeedingToolLayer(TOOL_RESULT),
          ),
        ),
      ),
    );

    expect(result.state.status).toBe("failed");
    expect(result.state.error ?? "").toContain("scaffold-leak");
    expect(result.state.error ?? "").toContain("Verifier rejected output");
  });

  it("a clean terminal answer is untouched (no extra synthesis call, no behavior change)", async () => {
    const scenario = [
      { toolCall: { name: "bench_price", args: { symbol: "XRP" } } },
      { text: TOOL_RESULT },
    ];

    const result = await Effect.runPromise(
      runPass(reactKernel, input, {
        ...runOpts,
        taskId: "scaffold-leak-terminal-repair-clean",
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            TestLLMServiceLayer(scenario),
            succeedingToolLayer(TOOL_RESULT),
          ),
        ),
      ),
    );

    expect(result.state.status).toBe("done");
    expect(result.output).toBe(TOOL_RESULT);
  });
});
