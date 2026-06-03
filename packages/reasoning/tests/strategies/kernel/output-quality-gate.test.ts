// File: tests/strategies/kernel/output-quality-gate.test.ts
import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { LLMService, TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { runKernel, assembleDeliverable } from "../../../src/kernel/loop/runner.js";
import { deliverableToContent } from "@reactive-agents/core";
import {
  initialKernelState,
  transitionState,
  type KernelState,
  type ThoughtKernel,
} from "../../../src/kernel/state/kernel-state.js";
import { makeStep } from "../../../src/kernel/capabilities/sense/step-utils.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Kernel that returns done immediately with the given output */
function makeDoneKernel(output: string): ThoughtKernel {
  return (state, _ctx) =>
    Effect.succeed(
      transitionState(state, {
        status: "done",
        output,
        iteration: state.iteration + 1,
      }),
    );
}

/** Kernel that simulates tool data collection then stalls (harness-deliverable path) */
function makeStallAfterToolKernel(toolOutput: string): ThoughtKernel {
  return (state, _ctx) => {
    const nextIter = state.iteration + 1;
    if (nextIter === 1) {
      // First iteration: do a "tool call" that produces an observation
      return Effect.succeed(
        transitionState(state, {
          status: "thinking",
          iteration: nextIter,
          toolsUsed: new Set([...state.toolsUsed, "web-search"]),
          steps: [
            ...state.steps,
            makeStep("thought", "Let me search for the data"),
            makeStep("action", "web-search"),
            makeStep("observation", toolOutput, {
              observationResult: {
                success: true,
                toolName: "web-search",
                displayText: "search results",
                category: "web-search" as const,
                resultKind: "data" as const,
                preserveOnCompaction: false,
              },
            }),
          ],
        }),
      );
    }
    // Subsequent iterations: stall (no new tools)
    return Effect.succeed(
      transitionState(state, {
        status: "thinking",
        iteration: nextIter,
        steps: [
          ...state.steps,
          makeStep("thought", "I should think more about this..."),
        ],
      }),
    );
  };
}

/** Kernel that calls the same tool repeatedly before stalling. */
function makeRepeatedToolKernel(toolOutputs: readonly string[]): ThoughtKernel {
  return (state, _ctx) => {
    const nextIter = state.iteration + 1;
    if (nextIter <= toolOutputs.length) {
      const toolOutput = toolOutputs[nextIter - 1]!;
      return Effect.succeed(
        transitionState(state, {
          status: "thinking",
          iteration: nextIter,
          toolsUsed: new Set([...state.toolsUsed, "spawn-agent"]),
          steps: [
            ...state.steps,
            makeStep("thought", `Delegate subtask ${nextIter}`),
            makeStep("action", "spawn-agent"),
            makeStep("observation", toolOutput, {
              observationResult: {
                success: true,
                toolName: "spawn-agent",
                displayText: `sub-agent result ${nextIter}`,
                category: "agent-delegate" as const,
                resultKind: "data" as const,
                preserveOnCompaction: false,
              },
            }),
          ],
        }),
      );
    }

    return Effect.succeed(
      transitionState(state, {
        status: "thinking",
        iteration: nextIter,
        steps: [
          ...state.steps,
          makeStep("thought", "I need a moment to synthesize these delegated results."),
        ],
      }),
    );
  };
}

/** Kernel that completes required web-search quantity before stalling. */
function makeQuotaSatisfyingSearchKernel(toolOutputs: readonly string[]): ThoughtKernel {
  return (state, _ctx) => {
    const nextIter = state.iteration + 1;
    if (nextIter <= toolOutputs.length) {
      const output = toolOutputs[nextIter - 1]!;
      return Effect.succeed(
        transitionState(state, {
          status: "thinking",
          iteration: nextIter,
          toolsUsed: new Set([...state.toolsUsed, "web-search"]),
          steps: [
            ...state.steps,
            makeStep("thought", `search item ${nextIter}`),
            makeStep("action", "web-search"),
            makeStep("observation", output, {
              observationResult: {
                success: true,
                toolName: "web-search",
                displayText: `search result ${nextIter}`,
                category: "web-search" as const,
                resultKind: "data" as const,
                preserveOnCompaction: false,
              },
            }),
          ],
        }),
      );
    }
    return Effect.succeed(
      transitionState(state, {
        status: "thinking",
        iteration: nextIter,
        steps: [...state.steps, makeStep("thought", "stalled after quota completion")],
      }),
    );
  };
}

const defaultOptions = {
  taskId: "test-task",
  strategy: "reactive",
  kernelType: "react",
  maxIterations: 10,
};

const testLayer = TestLLMServiceLayer();

function runWithTestLLM(effect: Effect.Effect<KernelState, never, LLMService>) {
  return Effect.runPromise(
    effect.pipe(Effect.provide(testLayer)),
  );
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("output quality gate", () => {
  it("passes output through when no format is requested", async () => {
    const kernel = makeDoneKernel("The answer is 42.");
    const state = await runWithTestLLM(
      runKernel(kernel, { task: "what is the meaning of life?" }, defaultOptions),
    );
    expect(state.status).toBe("done");
    expect(state.output).toBe("The answer is 42.");
    // No format was requested, so no validation metadata
    expect(state.meta.outputFormatValidated).toBeUndefined();
  });

  it("marks outputFormatValidated=true when model output matches requested format", async () => {
    const tableOutput = "| Name | Price |\n|------|-------|\n| BTC | 50000 |";
    const kernel = makeDoneKernel(tableOutput);
    const state = await runWithTestLLM(
      runKernel(
        kernel,
        { task: "generate a markdown table with prices" },
        defaultOptions,
      ),
    );
    expect(state.status).toBe("done");
    expect(state.output).toBe(tableOutput);
    expect(state.meta.outputFormatValidated).toBe(true);
  });

  it("records task intent format detection in the finalization pipeline", async () => {
    const kernel = makeDoneKernel('{"result": "test"}');
    const state = await runWithTestLLM(
      runKernel(
        kernel,
        { task: "return JSON with the results" },
        defaultOptions,
      ),
    );
    expect(state.status).toBe("done");
    expect(state.meta.outputFormatValidated).toBe(true);
  });

  it("marks outputFormatValidated=false when format doesn't match and sets reason", async () => {
    const kernel = makeDoneKernel("just some plain text, no table here");
    const state = await runWithTestLLM(
      runKernel(
        kernel,
        { task: "generate a markdown table with prices" },
        defaultOptions,
      ),
    );
    expect(state.status).toBe("done");
    // TestLLMServiceLayer returns mock content that probably won't form a valid table
    // so we check that the gate at least ran and set metadata
    expect(state.meta.outputFormatValidated).toBeDefined();
  });

  it("harness-deliverable path still works (stall → assembleDeliverable)", async () => {
    const kernel = makeStallAfterToolKernel("BTC price: $50,000. ETH price: $3,000.");
    const state = await runWithTestLLM(
      runKernel(
        kernel,
        { task: "what are the crypto prices?" },
        { ...defaultOptions, maxIterations: 5 },
      ),
    );
    expect(state.status).toBe("done");
    expect(state.meta.terminatedBy).toBe("harness_deliverable");
    // The harness should have assembled the tool artifacts
    expect(state.output).toContain("BTC price");
  });

  it("does not auto-deliver stalled artifacts when required tool quantity is still missing", async () => {
    const kernel = makeStallAfterToolKernel("XRP price: $1.33.");
    const state = await runWithTestLLM(
      runKernel(
        kernel,
        {
          task: "Fetch XRP, XLM, ETH, BTC prices",
          requiredTools: ["web-search"],
          requiredToolQuantities: { "web-search": 4 },
        },
        { ...defaultOptions, maxIterations: 5 },
      ),
    );

    expect(state.meta.terminatedBy).not.toBe("harness_deliverable");
    expect(state.status).not.toBe("done");
  });

  it("Pivot A REWORK — harness-deliverable fires verifier gate but does not retry", async () => {
    // M3 REWORK (2026-05-12): Terminal retry loop removed per ablation verdict.
    // Verifier gate still fires at harness_deliverable path (emits verdict event)
    // but rejection no longer injects a retry signal — iteration matches baseline.
    const kernel = makeQuotaSatisfyingSearchKernel([
      "XRP price: $1.33",
      "XLM price: $0.1558",
      "ETH price: $3,000",
      "BTC price: $50,000",
    ]);
    const state = await runWithTestLLM(
      runKernel(
        kernel,
        {
          task: "Fetch XRP, XLM, ETH, BTC prices",
          requiredTools: ["web-search"],
          requiredToolQuantities: { "web-search": 4 },
        },
        {
          ...defaultOptions,
          maxIterations: 12,
          loopDetection: { maxConsecutiveThoughts: 999, maxRepeatedThoughts: 999, maxSameToolCalls: 999 },
        },
      ),
    );

    expect(state.status).toBe("done");
    expect(state.meta.terminatedBy).toBe("harness_deliverable");
    // No retry injected — iteration well below maxIterations=12.
    expect(state.iteration).toBeLessThan(10);
  });

  it("allows harness-deliverable after required tool quantity is fully satisfied", async () => {
    const kernel = makeQuotaSatisfyingSearchKernel([
      "XRP price: $1.33",
      "XLM price: $0.1558",
      "ETH price: $3,000",
      "BTC price: $50,000",
    ]);
    const state = await runWithTestLLM(
      runKernel(
        kernel,
        {
          task: "Fetch XRP, XLM, ETH, BTC prices",
          requiredTools: ["web-search"],
          requiredToolQuantities: { "web-search": 4 },
        },
        { ...defaultOptions, maxIterations: 8, loopDetection: { maxConsecutiveThoughts: 999, maxRepeatedThoughts: 999, maxSameToolCalls: 999 } },
      ),
    );

    expect(state.status).toBe("done");
    expect(state.meta.terminatedBy).toBe("harness_deliverable");
    expect(state.output).toContain("BTC price");
  });

  it("does not treat repeated calls to the same tool as stalled progress", async () => {
    const kernel = makeRepeatedToolKernel([
      "Delegated result: XRP price is $1.33 in USD.",
      "Delegated result: XLM price is $0.1558 in USD.",
    ]);

    const state = await runWithTestLLM(
      runKernel(
        kernel,
        {
          task: "collect crypto prices via delegated sub-agents",
        },
        {
          ...defaultOptions,
          maxIterations: 8,
          loopDetection: {
            maxSameToolCalls: 10,
            maxRepeatedThoughts: 10,
            maxConsecutiveThoughts: 10,
          },
        },
      ),
    );

    expect(state.status).toBe("done");
    expect(state.meta.terminatedBy).toBe("harness_deliverable");
    expect(state.iteration).toBe(4);
    expect(state.output).toContain("XLM price");
  });

  it("assembleDeliverable resolves STORED previews via scratchpad for harness output", () => {
    const key = "_tool_result_1";
    const fullText = "Usage: rax agent create\n  --name string    Agent display name";
    const preview = `[STORED: ${key} | shell-execute]\n(banner omitted)\n...`;
    const obs = makeStep("observation", preview, {
      observationResult: {
        success: true,
        toolName: "shell-execute",
        displayText: "preview",
        category: "shell-execute" as const,
        resultKind: "data" as const,
        preserveOnCompaction: false,
      },
    });
    const base = initialKernelState({ ...defaultOptions, taskId: "t1" });
    const st = transitionState(base, {
      steps: [obs],
      toolsUsed: new Set(["shell-execute"]),
      scratchpad: new Map([[key, fullText]]),
    });
    const d = assembleDeliverable(st);
    // Single validated observation → tool_artifact (4-source contract).
    expect(d.source).toBe("tool_artifact");
    expect(deliverableToContent(d)).toContain("Usage: rax agent create");
    expect(deliverableToContent(d)).toContain("--name string");
  });

  it("assembleDeliverable resolves compressed previews via metadata.storedKey", () => {
    const key = "_tool_result_5";
    const fullText = JSON.stringify({
      summary: { total: 4, succeeded: 4, failed: 0 },
      results: [
        { name: "find-xrp-price", output: "$1.32" },
        { name: "find-xlm-price", output: "$0.1508" },
      ],
    });
    const preview = [
      "[spawn-agents result — compressed preview]",
      "Type: Object(2 keys)",
      "  results: Array(4)",
      "  summary: {total, succeeded, failed}",
      "  — full object is stored.",
    ].join("\n");

    const obs = makeStep("observation", preview, {
      storedKey: key,
      observationResult: {
        success: true,
        toolName: "spawn-agents",
        displayText: "preview",
        category: "agent-delegate" as const,
        resultKind: "data" as const,
        preserveOnCompaction: false,
      },
    });
    const base = initialKernelState({ ...defaultOptions, taskId: "t2" });
    const st = transitionState(base, {
      steps: [obs],
      toolsUsed: new Set(["spawn-agents"]),
      scratchpad: new Map([[key, fullText]]),
    });

    const d = assembleDeliverable(st);
    expect(d.source).toBe("tool_artifact");
    const assembled = deliverableToContent(d);
    expect(assembled).toContain('"find-xrp-price"');
    expect(assembled).toContain('"succeeded":4');
  });

  it("assembleDeliverable resolves recall() key hints when STORED header is absent", () => {
    const key = "_tool_result_7";
    const fullText = "Bitcoin: 70836.96\nEthereum: 3850.00\nXRP: 1.32\nXLM: 0.1508";
    const preview = [
      "[spawn-agents result — compressed preview]",
      "Type: Object(2 keys)",
      "  results: Array(4)",
      "  summary: {total, succeeded, failed}",
      `  — full object is stored. Use recall(\"${key}\", start: 0, maxChars: 1200).`,
    ].join("\n");

    const obs = makeStep("observation", preview, {
      observationResult: {
        success: true,
        toolName: "spawn-agents",
        displayText: "preview",
        category: "agent-delegate" as const,
        resultKind: "data" as const,
        preserveOnCompaction: false,
      },
    });
    const base = initialKernelState({ ...defaultOptions, taskId: "t3" });
    const st = transitionState(base, {
      steps: [obs],
      toolsUsed: new Set(["spawn-agents"]),
      scratchpad: new Map([[key, fullText]]),
    });

    const d = assembleDeliverable(st);
    expect(d.source).toBe("tool_artifact");
    const assembled = deliverableToContent(d);
    expect(assembled).toContain("Bitcoin: 70836.96");
    expect(assembled).toContain("XLM: 0.1508");
  });

  it("assembleDeliverable rejects observations without observationResult metadata", () => {
    // Repro: Phase-A context-stress 2026-06-01 — model calls a non-existent
    // tool (`code-execute`), native-fc dispatch emits an observation with
    // content = the rejection string ("Tool call used unavailable name(s)...")
    // and NO `observationResult` metadata. The prior fall-through accepted
    // such observations if any real tool was in state.toolsUsed, leaking
    // dispatch-error strings into the harness deliverable.
    const rejection =
      "Tool call used unavailable name(s): code-execute. Available tools: file-read, brief. Use exact tool names from Available Tools.";
    const dispatchReject = makeStep("observation", rejection);
    const realObs = makeStep("observation", "Real tool output: ZEBRA-CODA", {
      observationResult: {
        success: true,
        toolName: "file-read",
        displayText: "real output",
        category: "filesystem" as const,
        resultKind: "data" as const,
        preserveOnCompaction: false,
      },
    });
    const base = initialKernelState({ ...defaultOptions, taskId: "t-reject" });
    const st = transitionState(base, {
      steps: [realObs, dispatchReject],
      toolsUsed: new Set(["file-read"]),
    });
    const d = assembleDeliverable(st);
    // Exactly one validated observation survives the metadata gate → tool_artifact.
    expect(d.source).toBe("tool_artifact");
    const assembled = deliverableToContent(d);
    expect(assembled).toContain("ZEBRA-CODA");
    expect(assembled).not.toContain("unavailable name(s)");
  });

  it("assembleDeliverable returns harness_synthesis for multiple validated observations", () => {
    const obsA = makeStep("observation", "Result A: BTC $50,000", {
      observationResult: {
        success: true,
        toolName: "web-search",
        displayText: "a",
        category: "web-search" as const,
        resultKind: "data" as const,
        preserveOnCompaction: false,
      },
    });
    const obsB = makeStep("observation", "Result B: ETH $3,000", {
      observationResult: {
        success: true,
        toolName: "web-search",
        displayText: "b",
        category: "web-search" as const,
        resultKind: "data" as const,
        preserveOnCompaction: false,
      },
    });
    const base = initialKernelState({ ...defaultOptions, taskId: "t-multi" });
    const st = transitionState(base, {
      steps: [obsA, obsB],
      toolsUsed: new Set(["web-search"]),
    });
    const d = assembleDeliverable(st);
    expect(d.source).toBe("harness_synthesis");
    const assembled = deliverableToContent(d);
    expect(assembled).toContain("Result A: BTC $50,000");
    expect(assembled).toContain("Result B: ETH $3,000");
  });

  it("assembleDeliverable returns model_synthesis for a substantive trailing thought", () => {
    const thought =
      "Synthesizing the findings: BTC is at $50,000 and ETH is at $3,000. " +
      "These reflect current market conditions across the major exchanges surveyed.";
    const obs = makeStep("observation", "raw data dump", {
      observationResult: {
        success: true,
        toolName: "web-search",
        displayText: "raw",
        category: "web-search" as const,
        resultKind: "data" as const,
        preserveOnCompaction: false,
      },
    });
    const base = initialKernelState({ ...defaultOptions, taskId: "t-model" });
    const st = transitionState(base, {
      steps: [makeStep("action", "web-search"), obs, makeStep("thought", thought)],
      toolsUsed: new Set(["web-search"]),
    });
    const d = assembleDeliverable(st);
    expect(d.source).toBe("model_synthesis");
    expect(deliverableToContent(d)).toContain("Synthesizing the findings");
  });

  it("assembleDeliverable returns sentinel when no validated artifacts or thought exist", () => {
    const base = initialKernelState({ ...defaultOptions, taskId: "t-empty" });
    const st = transitionState(base, { steps: [] });
    const d = assembleDeliverable(st);
    expect(d.source).toBe("sentinel");
    expect(deliverableToContent(d)).toBe("Task complete.");
  });
});
