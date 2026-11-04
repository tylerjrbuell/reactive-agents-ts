/**
 * Loop detection runs at TURN boundaries, never mid-turn.
 *
 * `kernel()` runs ONE phase per iterate pass. A think phase that resolves a
 * tool call appends its `thought` step and leaves `status: "acting"` with the
 * calls on `meta.pendingNativeToolCalls`; the `action` step only lands when the
 * act phase runs on the NEXT pass. Loop detection used to run on that half-done
 * state, so the turn's own thought pushed the consecutive-thoughts streak (IC-1:
 * only actions reset it) over the threshold and the strategy switch reinitialised
 * the kernel, discarding the pending call. H3 evidence: qwen3:4b rw-2/run0, a
 * native file-write for analysis.md (seq 87) dropped by `strategy-switched`
 * `pattern=c` 9ms later (seq 95), never executed.
 *
 * Pins:
 *   1. scripted think/act kernel: N-1 thought-only turns, then a tool-call turn
 *      that would cross the streak — the call executes, no switch fires.
 *   2. negative: pure thought-only turns still trigger the switch.
 *   3. real ReAct kernel (TestLLMService native FC + mock ToolService): same
 *      shape end-to-end — the scripted tool runs.
 *   4. observability: a switch that does fire with calls pending emits a
 *      `strategy_switch` guard-fired record carrying `pendingToolCalls`.
 */
import { describe, expect, it } from "bun:test";
import { Effect, Ref } from "effect";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { EventBus, EventBusLive, type AgentEvent } from "@reactive-agents/core";
import { runKernel } from "./runner.js";
import { applyStrategySwitch } from "./runner-helpers/strategy-switch.js";
import { makeStep } from "../capabilities/sense/step-utils.js";
import { makeObservationResult } from "../utils/observation-helpers.js";
import {
  initialKernelState,
  noopHooks,
  transitionState,
  type KernelContext,
  type KernelState,
  type ThoughtKernel,
} from "../state/kernel-state.js";
import { makeKernelInput, makeKernelRunOptions } from "../../testing/kernel-fixtures.js";
import { mockToolServiceLayer } from "../../testing/tool-service-mock.js";
import { executeReactive } from "../../strategies/reactive.js";
import { defaultReasoningConfig } from "../../types/config.js";
import { provideTestEnvelope } from "../envelope/run-envelope.js";

const SWITCHING = {
  enabled: true,
  maxSwitches: 1,
  fallbackStrategy: "plan-execute-reflect",
  availableStrategies: ["plan-execute-reflect"],
} as const;

const PENDING_CALL = { id: "call-1", name: "file-write", arguments: { path: "analysis.md", content: "x" } };

/**
 * A two-phase kernel that mirrors the real think/act protocol: thought-only
 * turns for the first `thoughtOnlyTurns` thinks, then (unless `neverAct`) a
 * think that leaves `status: "acting"` + pendingNativeToolCalls, executed by
 * the act phase on the next pass. After the act it finishes.
 */
function makeTurnKernel(opts: { thoughtOnlyTurns: number; neverAct?: boolean }, executed: { count: number }): ThoughtKernel {
  let thinks = 0;
  return (state: KernelState, _ctx: KernelContext) => {
    if (state.strategy !== "reactive") {
      return Effect.succeed(transitionState(state, { status: "done", output: "switched", iteration: state.iteration + 1 }));
    }
    if (state.status === "acting") {
      const calls = state.meta.pendingNativeToolCalls ?? [];
      executed.count += calls.length;
      const steps = calls.flatMap((c) => [
        makeStep("action", JSON.stringify({ tool: c.name, input: c.arguments }), { toolCall: c }),
        makeStep("observation", "written", { toolCallId: c.id, observationResult: makeObservationResult(c.name, true, "written") }),
      ]);
      return Effect.succeed(transitionState(state, {
        status: "thinking",
        iteration: state.iteration + 1,
        steps: [...state.steps, ...steps],
        meta: { ...state.meta, pendingNativeToolCalls: undefined },
      }));
    }
    thinks++;
    if (executed.count > 0) {
      return Effect.succeed(transitionState(state, { status: "done", output: "analysis written", iteration: state.iteration + 1 }));
    }
    const thought = makeStep("thought", `thinking ${thinks}`);
    if (opts.neverAct || thinks <= opts.thoughtOnlyTurns) {
      return Effect.succeed(transitionState(state, { status: "thinking", iteration: state.iteration + 1, steps: [...state.steps, thought] }));
    }
    // The tool-call turn: thought step + pending call, NO action step yet.
    return Effect.succeed(transitionState(state, {
      status: "acting",
      steps: [...state.steps, thought],
      meta: { ...state.meta, pendingNativeToolCalls: [PENDING_CALL] },
    }));
  };
}

const runTurns = (kernel: ThoughtKernel) =>
  Effect.runPromise(
    runKernel(kernel, { task: "write analysis.md" }, {
      maxIterations: 12,
      strategy: "reactive",
      kernelType: "react",
      loopDetection: { maxConsecutiveThoughts: 3 },
      strategySwitching: SWITCHING,
    }).pipe(Effect.provide(TestLLMServiceLayer())),
  );

describe("loop detection waits for the turn's pending tool calls", () => {
  it("a tool-call turn that would cross the consecutive-thoughts streak executes its call; no switch drops it", async () => {
    const executed = { count: 0 };
    // 2 thought-only turns + the tool-call turn's own thought = 3 = threshold.
    const result = await runTurns(makeTurnKernel({ thoughtOnlyTurns: 2 }, executed));
    expect(executed.count).toBe(1);
    expect(result.strategy).toBe("reactive");
    expect(result.status).toBe("done");
    expect(result.output).toBe("analysis written");
  });

  it("negative: pure thought-only turns still trigger the strategy switch", async () => {
    const executed = { count: 0 };
    const result = await runTurns(makeTurnKernel({ thoughtOnlyTurns: 0, neverAct: true }, executed));
    expect(executed.count).toBe(0);
    expect(result.strategy).toBe("plan-execute-reflect");
  });
});

describe("real ReAct kernel: thought-only turns then a native tool call", () => {
  it("the scripted native call executes instead of being dropped by a loop switch", async () => {
    const calls: string[] = [];
    const toolLayer = mockToolServiceLayer({
      execute: (input: { toolName: string }) => {
        calls.push(input.toolName);
        return Effect.succeed({ success: true, result: "5" });
      },
      getTool: (name: string) =>
        Effect.succeed({ name, description: "Add two numbers", parameters: [
          { name: "a", type: "number", required: true },
          { name: "b", type: "number", required: true },
        ] }),
    });
    const llm = TestLLMServiceLayer([
      { text: "Hmm." },
      { text: "Hmm." },
      { toolCall: { name: "add", args: { a: 2, b: 3 } } },
      { text: "FINAL ANSWER: 5" },
    ]);
    const result = await Effect.runPromise(provideTestEnvelope(
      executeReactive({
        taskDescription: "Add 2 and 3 with the add tool",
        taskType: "computation",
        memoryContext: "",
        availableTools: ["add"],
        // Required so a thought-only "Hmm." turn cannot terminate end_turn.
        requiredTools: ["add"],
        availableToolSchemas: [{ name: "add", description: "Add two numbers", parameters: [
          { name: "a", type: "number", description: "a", required: true },
          { name: "b", type: "number", description: "b", required: true },
        ] }],
        config: {
          ...defaultReasoningConfig,
          strategies: { ...defaultReasoningConfig.strategies, reactive: { maxIterations: 8, temperature: 0.7 } },
        },
        strategySwitching: { enabled: true, maxSwitches: 1, fallbackStrategy: "plan-execute-reflect" },
      }).pipe(Effect.provide(llm), Effect.provide(toolLayer)),
    ));
    expect(calls).toContain("add");
    expect(result.steps.some((s) => s.type === "action")).toBe(true);
    expect(result.steps.some((s) => s.type === "harness_signal" && s.content.includes("Strategy switched"))).toBe(false);
  });
});

describe("strategy switch records calls it would drop", () => {
  const guardEvents = (state: KernelState) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const events = yield* Ref.make<AgentEvent[]>([]);
        const bus = yield* EventBus;
        yield* bus.on("GuardFiredEmitted", (ev) => Ref.update(events, (xs) => [...xs, ev]));
        const input = makeKernelInput({ task: "t" });
        yield* applyStrategySwitch({
          state,
          currentInput: input,
          context: { input } as KernelContext,
          options: makeKernelRunOptions({ strategy: "reactive", taskId: "sw" }),
          hooks: noopHooks,
          triedStrategies: ["reactive"],
          switchCount: 0,
          fromStrategy: "reactive",
          toStrategy: "plan-execute-reflect",
          failureReason: "loop",
        });
        return yield* Ref.get(events);
      }).pipe(Effect.provide(EventBusLive)),
    );

  const base = initialKernelState(makeKernelRunOptions({ strategy: "reactive", taskId: "sw" }));

  it("emits strategy_switch guard-fired with pendingToolCalls when calls are pending", async () => {
    const state = transitionState(base, { status: "acting", meta: { ...base.meta, pendingNativeToolCalls: [PENDING_CALL] } });
    const events = await guardEvents(state);
    const g = events.find((e) => e._tag === "GuardFiredEmitted" && e.guard === "strategy_switch");
    expect(g).toBeDefined();
    if (g === undefined || g._tag !== "GuardFiredEmitted") return;
    expect(g.metadata).toMatchObject({ pendingToolCalls: 1, pendingToolNames: ["file-write"] });
  });

  it("emits nothing extra when no calls are pending", async () => {
    const events = await guardEvents(base);
    expect(events.filter((e) => e._tag === "GuardFiredEmitted" && e.guard === "strategy_switch")).toHaveLength(0);
  });
});
