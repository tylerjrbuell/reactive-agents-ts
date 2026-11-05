// Run: bun test packages/reasoning/tests/kernel/act/batch-duplicate-pairing.test.ts --timeout 15000
//
// Plan 9 live H3 finding (cogito run 01M6MBTSV7MQZS6QYHMFM2SYHH, seq
// 2452/2481/2510): a re-read of b.json inside a parallel batch was answered
// with a.json's content. Root cause: the parallel-batch path records
// [actionA, actionB, observationA, observationB], while `duplicateGuard`
// paired an action with `steps[idx + 1]` positionally — so actionB's "prior
// result" was observationA. These tests drive the real `act.ts` batch path
// and pin call-id pairing.
import { describe, it, expect } from "bun:test";
import { Effect, Option } from "effect";
import { HarnessPipeline, RegistrationHarness } from "@reactive-agents/core";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { handleActing } from "../../../src/kernel/capabilities/act/act.js";
import { duplicateGuard } from "../../../src/kernel/capabilities/act/guard.js";
import { observationForAction, makeStep } from "../../../src/kernel/capabilities/sense/step-utils.js";
import { TextParseDriver } from "@reactive-agents/tools";
import {
  initialKernelState,
  noopHooks,
  type KernelContext,
  type KernelInput,
  type KernelState,
  type ToolServiceInstance,
} from "../../../src/kernel/state/kernel-state.js";
import { CONTEXT_PROFILES } from "../../../src/context/context-profile.js";
import type { StepId } from "../../../src/types/step.js";

type Call = { id: string; name: string; arguments: Record<string, unknown> };

/** Returns distinct content per url so a cross-call bleed is visible. */
function contentToolService(): Option.Option<ToolServiceInstance> {
  return Option.some({
    execute: (req) => {
      const url = String((req.arguments as Record<string, unknown>).url);
      return Effect.succeed({ success: true, result: url.endsWith("a.json") ? "A-CONTENT" : "B-CONTENT" });
    },
    getTool: () => Effect.fail(new Error("no schema")),
    listTools: () => Effect.succeed([]),
  });
}

function stateWith(steps: KernelState["steps"], pending: readonly Call[]): KernelState {
  return {
    ...initialKernelState({ maxIterations: 5, strategy: "react-kernel", kernelType: "react", taskId: "dup-pairing" }),
    status: "acting",
    steps: [...steps],
    meta: { pendingNativeToolCalls: [...pending], lastThought: "go", lastThinking: null },
  };
}

function context(): KernelContext {
  const profile = CONTEXT_PROFILES["mid"];
  return {
    input: {
      task: "Read both files",
      availableToolSchemas: [{ name: "http-get", description: "fetch a url", parameters: [] }],
      harnessPipeline: new HarnessPipeline(new RegistrationHarness()._collected),
      nextMovesPlanning: { enabled: true, allowParallelBatching: true, maxBatchSize: 3 },
    } as KernelContext["input"],
    profile,
    compression: { budget: profile.toolResultMaxChars ?? 800, previewItems: 3, autoStore: true, codeTransform: true },
    toolService: contentToolService(),
    hooks: noopHooks,
    toolCallingDriver: new TextParseDriver(),
  };
}

const batch = (suffix: string): Call[] => [
  { id: `a-${suffix}`, name: "http-get", arguments: { url: "https://x/a.json" } },
  { id: `b-${suffix}`, name: "http-get", arguments: { url: "https://x/b.json" } },
];

function obsFor(state: KernelState, callId: string): string {
  return state.steps.find((s) => s.type === "observation" && s.metadata?.toolCallId === callId)?.content ?? "";
}

describe("parallel batch — duplicate re-read pairs by call id", () => {
  it("a repeated batch re-read of b.json returns b.json content, never a.json's", async () => {
    const thought = { id: "t-1" as StepId, type: "thought" as const, content: "go", timestamp: new Date() };
    const first = await Effect.runPromise(
      handleActing(stateWith([thought], batch("1")), context()).pipe(Effect.provide(TestLLMServiceLayer())),
    );
    expect(obsFor(first, "a-1")).toContain("A-CONTENT");
    expect(obsFor(first, "b-1")).toContain("B-CONTENT");

    const second = await Effect.runPromise(
      handleActing(stateWith(first.steps, batch("2")), context()).pipe(Effect.provide(TestLLMServiceLayer())),
    );
    expect(obsFor(second, "b-2")).toContain("B-CONTENT");
    expect(obsFor(second, "b-2")).not.toContain("A-CONTENT");
    expect(obsFor(second, "a-2")).toContain("A-CONTENT");
  });

  it("duplicateGuard serves the call-id-paired observation for [actA, actB, obsA, obsB]", () => {
    const act = (id: string, url: string) =>
      makeStep("action", `http-get(${url})`, { toolCall: { id, name: "http-get", arguments: { url } } });
    const obs = (id: string, content: string) =>
      makeStep("observation", content, {
        toolCallId: id,
        observationResult: { success: true, toolName: "http-get", displayText: content, category: "web-search", resultKind: "data", preserveOnCompaction: false },
      });
    const steps = [act("a", "a.json"), act("b", "b.json"), obs("a", "A-CONTENT"), obs("b", "B-CONTENT")];
    expect(observationForAction(steps, 1)?.content).toBe("B-CONTENT");
    const outcome = duplicateGuard(
      { id: "b2", name: "http-get", arguments: { url: "b.json" } },
      stateWith(steps, []),
      { task: "x" } as KernelInput,
    );
    expect(outcome.pass).toBe(false);
    if (!outcome.pass) {
      expect(outcome.observation).toContain("B-CONTENT");
      expect(outcome.observation).not.toContain("A-CONTENT");
    }
  });
});
