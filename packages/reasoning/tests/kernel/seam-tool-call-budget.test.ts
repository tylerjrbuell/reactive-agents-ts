// Run: bun test packages/reasoning/tests/kernel/seam-tool-call-budget.test.ts --timeout 20000
//
// maxCallsPerTool rides RunEnvelope.rails (one carrier, no per-strategy
// forwarding). Kernel passes get it through mergeRunEnvelopeIntoKernelInput;
// 0-LLM direct dispatch (plan tool_call steps, code-action's sandbox) reserves
// against the run's ToolCallBudget. End-to-end over every strategy: conformance
// C10 (tests/strategies/strategy-conformance.test.ts).
//
// One run-wide count (run-tool-call-counts.ts): the kernel gate reads and
// charges the same run slot the direct-dispatch budget reserves on, so a
// fresh pass state (a later pass, a strategy switch) cannot reset a cap.
// RED-ON-CUT (shown during the mission, then restored): drop the
// `spentPerCappedTool(...)` argument in gateTurnToolCalls → "two unseeded
// passes in one run" and "direct dispatch then a kernel pass" fail (the second
// call runs), as do (b)/(c) in tests/strategies/max-calls-per-tool-run-count;
// skip the `chargeToolCall` loop → "two unseeded passes in one run" and "a
// kernel pass then direct dispatch" fail (nothing charged the run count).
import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { rootContext } from "@reactive-agents/core";
import { childRunScope, getRunSlot, withRunScope } from "@reactive-agents/core/internal/run-scope";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { makeToolCallBudget, unlimitedToolCallBudget } from "../../src/kernel/capabilities/decide/tool-call-budget.js";
import { toolCallCountsSlot } from "../../src/kernel/capabilities/decide/run-tool-call-counts.js";
import { reactKernel } from "../../src/kernel/loop/react-kernel.js";
import { runPass } from "../../src/kernel/loop/run-pass.js";
import { mockToolServiceLayer } from "../../src/testing/tool-service-mock.js";
import type { KernelInput } from "../../src/kernel/state/kernel-state.js";
import {
  buildRunEnvelope,
  mergeRunEnvelopeIntoKernelInput,
  withMaxCallsPerTool,
} from "../../src/kernel/envelope/run-envelope.js";

describe("ToolCallBudget", () => {
  it("admits calls up to the cap, then refuses with the kernel gate's text", () => {
    const budget = makeToolCallBudget({ add: 2 });
    expect(budget.reserve("add")).toBeUndefined();
    expect(budget.reserve("add")).toBeUndefined();
    expect(budget.reserve("add")).toBe(
      "add was not run: its per-tool call budget is used up (2 of 2 calls). Do not call add again; work with the results you already have.",
    );
    // A refused call is not counted: the text stays at 2 of 2.
    expect(budget.reserve("add")).toContain("(2 of 2 calls)");
  });

  it("never limits a tool with no cap, and no caps means the unlimited budget", () => {
    const budget = makeToolCallBudget({ add: 1 });
    for (let i = 0; i < 5; i++) expect(budget.reserve("search")).toBeUndefined();
    expect(makeToolCallBudget(undefined)).toBe(unlimitedToolCallBudget);
  });
});

describe("maxCallsPerTool on the RunEnvelope", () => {
  it("withMaxCallsPerTool folds caps onto the rails; caps already there win; absent is a no-op", () => {
    const base = buildRunEnvelope();
    expect(withMaxCallsPerTool(base, undefined)).toBe(base);
    expect(withMaxCallsPerTool(base, { add: 1 }).rails.maxCallsPerTool).toEqual({ add: 1 });
    const carried = buildRunEnvelope({ maxCallsPerTool: { add: 3 } });
    expect(withMaxCallsPerTool(carried, { add: 1 }).rails.maxCallsPerTool).toEqual({ add: 3 });
  });

  it("runKernel's merge fills KernelInput.maxCallsPerTool; an explicit pass value wins; no caps writes no key", () => {
    const envelope = buildRunEnvelope({ maxCallsPerTool: { add: 1 } });
    expect(mergeRunEnvelopeIntoKernelInput({ task: "t" }, envelope).maxCallsPerTool).toEqual({ add: 1 });
    expect(mergeRunEnvelopeIntoKernelInput({ task: "t", maxCallsPerTool: { add: 4 } }, envelope).maxCallsPerTool).toEqual({ add: 4 });
    expect("maxCallsPerTool" in mergeRunEnvelopeIntoKernelInput({ task: "t" }, buildRunEnvelope())).toBe(false);
  });
});

const SEARCH = { name: "web-search", description: "search the web", parameters: [{ name: "query", type: "string", required: true }] };
const CAPS = { "web-search": 1 };
const CAPPED: KernelInput = { task: "Look up the answer with web-search", availableToolSchemas: [SEARCH], maxCallsPerTool: CAPS };

/** One unseeded react pass (fresh kernel state) that calls web-search once, then answers. */
const searchPass = (executed: string[]) =>
  runPass(reactKernel, CAPPED, { maxIterations: 4, strategy: "reactive", kernelType: "react", taskId: "budget-seam" }).pipe(
    Effect.provide(
      Layer.mergeAll(
        TestLLMServiceLayer([{ toolCall: { name: "web-search", args: { query: "a" } } }, { text: "FINAL ANSWER: done." }]),
        mockToolServiceLayer({
          execute: (req) =>
            Effect.sync(() => {
              executed.push(req.toolName);
              return { success: true, result: { ok: true } };
            }),
        }),
      ),
    ),
  );

const inRun = <A, E>(effect: Effect.Effect<A, E>): Promise<A> =>
  Effect.runPromise(effect.pipe(withRunScope(rootContext("budget-seam", "test"))));

/** The run's direct-dispatch budget over the run slot (what `runStrategy` builds). */
const runBudget = getRunSlot(toolCallCountsSlot).pipe(Effect.map((counts) => makeToolCallBudget(CAPS, counts)));

describe("maxCallsPerTool: one run-wide count for kernel passes and direct dispatch", () => {
  it("two unseeded passes in one run: the second pass's call is refused (a fresh pass state does not reset the cap)", async () => {
    const executed: string[] = [];
    await inRun(Effect.gen(function* () {
      yield* searchPass(executed);
      yield* searchPass(executed);
    }));
    expect(executed).toEqual(["web-search"]);
  }, 20000);

  it("direct dispatch then a kernel pass: the kernel call is refused", async () => {
    const executed: string[] = [];
    const reserved = await inRun(Effect.gen(function* () {
      const reservation = (yield* runBudget).reserve("web-search");
      yield* searchPass(executed);
      return reservation;
    }));
    expect(reserved).toBeUndefined();
    expect(executed).toEqual([]);
  }, 20000);

  it("a kernel pass then direct dispatch: the gate charged the run count, so the budget refuses", async () => {
    const executed: string[] = [];
    const refusal = await inRun(Effect.gen(function* () {
      yield* searchPass(executed);
      return (yield* runBudget).reserve("web-search");
    }));
    expect(executed).toEqual(["web-search"]);
    expect(refusal).toContain("web-search was not run: its per-tool call budget is used up (1 of 1 calls)");
  }, 20000);

  it("a sub-agent's run has its own count: the parent's spent cap does not refuse the child's call", async () => {
    const executed: string[] = [];
    await inRun(Effect.gen(function* () {
      yield* searchPass(executed);
      yield* searchPass(executed).pipe(childRunScope(rootContext("budget-seam-child", "child")));
    }));
    expect(executed).toEqual(["web-search", "web-search"]);
  }, 20000);

  it("outside a run scope a bare pass is its own run: each counts from its own ledger", async () => {
    const executed: string[] = [];
    await Effect.runPromise(Effect.gen(function* () {
      yield* searchPass(executed);
      yield* searchPass(executed);
    }));
    expect(executed).toEqual(["web-search", "web-search"]);
  }, 20000);
});
