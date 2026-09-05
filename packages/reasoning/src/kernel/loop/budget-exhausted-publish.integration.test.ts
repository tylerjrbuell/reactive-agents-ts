// Run: bun test packages/reasoning/src/kernel/loop/budget-exhausted-publish.integration.test.ts --timeout 15000
//
// D-1 amendment (2026-08-27 dead-signal-wiring plan, Task 3 narrowed):
// `BudgetExhausted` had 1 consumer (MetricsCollector's `budget.exhausted`
// counter) and 0 producers. The compose `budgetLimit()` killswitch computes
// the real budgetType/limit/used figures but only ever returned them as a
// templated `reason` string — never published to the EventBus.
//
// `budgetLimit()`'s hook registers on `before('think')`, which is consumed at
// exactly one runtime site: `iterate-pass.ts`'s `beforeThinkAbort` handling.
// That site now publishes `BudgetExhausted` (via the `Option<EventBusInstance>`
// already in scope) whenever the abort carries the new `meta` field, before
// transitioning state.
//
// This test does NOT import `@reactive-agents/compose` (reasoning has no
// dependency on it, and compose ships pre-built `dist/`, so a source edit
// there would not be picked up without an extra build step). Instead it
// registers an inline `before('think')` hook with the exact same
// abort-with-meta shape `budgetLimit()` produces — `packages/compose/test/
// killswitches.test.ts` pins that shape is what `budgetLimit()` actually
// returns. Together the two tests cover the full chain: compose computes the
// real numbers → iterate-pass.ts publishes them.
//
// Why a REAL EventBus subscription instead of stubbing the publish call:
// mirrors `ledger/ledger-tap.test.ts` — `runPass` builds its EventBus-backed
// wiring internally, so subscribing to a live `EventBusLive` layer is the
// only way to observe the publish end to end.

import { describe, expect, it } from "bun:test";
import { Effect, Layer, Ref } from "effect";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { EventBus, EventBusLive, HarnessPipeline, RegistrationHarness } from "@reactive-agents/core";
import type { Harness } from "@reactive-agents/core";
import { mockToolServiceLayer } from "../../testing/tool-service-mock.js";
import { reactKernel } from "./react-kernel.js";
import { runPass } from "./run-pass.js";
import type { KernelInput } from "../state/kernel-state.js";

// Same tool + scenario shape as `ledger/ledger-tap.test.ts`: a tool-call turn
// (which accrues real, non-zero `state.tokens`) followed by a final-answer
// turn. `before('think')` fires at the START of each iteration, so the abort
// on iteration 2 (checked against tokens accrued by iteration 1) is the
// earliest point a token-budget gate can actually fire.
const toolLayer = mockToolServiceLayer({
  execute: () => Effect.succeed({ success: true, result: { finding: "KEY FACT" } }),
  getTool: (name: string) =>
    Effect.succeed({ name, description: "test", parameters: [{ name: "q", type: "string", required: true }] }),
});

const SCHEMAS = [
  { name: "alpha", description: "gather a", parameters: [{ name: "q", type: "string", required: true }] },
];

const scenario = () =>
  TestLLMServiceLayer([
    { toolCall: { name: "alpha", args: { q: "go" } } },
    { text: "Done — the answer is 42." },
  ]);

/** Mirrors budgetLimit()'s `before('think')` abort+meta shape (compose/src/killswitches/budget-limit.ts). */
function tokenBudgetGate(maxTokens: number): (harness: Harness) => void {
  return (harness) => {
    harness.before("think", (ctx) => {
      const tokens = ctx.state.tokens;
      if (tokens >= maxTokens) {
        return {
          abort: "stop",
          reason: `budget-limit:tokens:${tokens}/${maxTokens}`,
          meta: { budgetType: "tokens", limit: maxTokens, used: tokens },
        };
      }
      return undefined;
    });
  };
}

function buildHarnessPipeline(maxTokens: number): HarnessPipeline {
  const reg = new RegistrationHarness();
  tokenBudgetGate(maxTokens)(reg);
  return new HarnessPipeline(reg._collected as ConstructorParameters<typeof HarnessPipeline>[0]);
}

const TEST_AGENT_ID = "budget-exhausted-publish-agent";

const run = (harnessPipeline: HarnessPipeline) =>
  Effect.gen(function* () {
    const sink = yield* Ref.make<
      readonly { budgetType: string; limit: number; used: number; agentId: string; timestamp: number }[]
    >([]);
    const bus = yield* EventBus;
    yield* bus.on("BudgetExhausted", (ev) => Ref.update(sink, (xs) => [...xs, ev]));
    const pass = yield* runPass(
      reactKernel,
      {
        task: "Answer the question using the alpha tool.",
        availableToolSchemas: SCHEMAS,
        agentId: TEST_AGENT_ID,
        harnessPipeline,
      } as KernelInput,
      {
        maxIterations: 6,
        strategy: "reactive",
        kernelType: "react",
        taskId: "budget-exhausted-publish-test",
        modelId: "llama3.2:3b",
      },
    );
    const seen = yield* Ref.get(sink);
    return { pass, seen };
  }).pipe(Effect.provide(Layer.mergeAll(scenario(), toolLayer, EventBusLive)));

describe("BudgetExhausted — publishes when a before('think') killswitch aborts on budget", () => {
  it("publishes BudgetExhausted with the real budgetType/limit/used/agentId when the run aborts", async () => {
    // Threshold of 1: any non-zero token count from the first (tool-call) turn
    // trips the gate before the second think call.
    const { pass, seen } = await Effect.runPromise(run(buildHarnessPipeline(1)));

    expect(pass.state.meta.terminatedBy).toBe("budget-limit:tokens:" + pass.state.tokens + "/1");
    expect(seen.length).toBe(1);
    expect(seen[0]?.budgetType).toBe("tokens");
    expect(seen[0]?.limit).toBe(1);
    expect(seen[0]?.used).toBe(pass.state.tokens);
    expect(seen[0]?.used).toBeGreaterThan(0);
    expect(seen[0]?.agentId).toBe(TEST_AGENT_ID);
    expect(typeof seen[0]?.timestamp).toBe("number");
  });

  it("publishes nothing when the run finishes under budget", async () => {
    const { pass, seen } = await Effect.runPromise(run(buildHarnessPipeline(1_000_000)));

    expect(pass.state.meta.terminatedBy).not.toContain("budget-limit");
    expect(seen.length).toBe(0);
  });
});
