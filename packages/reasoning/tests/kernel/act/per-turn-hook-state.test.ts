// Run: bun test packages/reasoning/tests/kernel/act/per-turn-hook-state.test.ts --timeout 15000
//
// Per-turn hooks see the state of their moment (2026-11-18, dx-warden find):
//  - `after act`, `before observe` and `after observe` see the round's merged
//    state: the observation steps and tools this round just ran
//    (act/round-hooks.ts). They used to get the pre-round state, so an act
//    hook could not see the tool it had just run.
//  - `before think` and `after think` for one turn report the same 0-indexed
//    `iteration`. The after hook used to read the counter after the think
//    step had advanced it.
import { describe, expect, it } from "bun:test";
import { Effect, Layer } from "effect";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { EventBusLive, HarnessPipeline, RegistrationHarness, type Phase, type PhaseHookFn } from "@reactive-agents/core";
import { mockToolServiceLayer } from "../../../src/testing/tool-service-mock.js";
import { reactKernel } from "../../../src/kernel/loop/react-kernel.js";
import { runPass } from "../../../src/kernel/loop/run-pass.js";
import type { KernelInput, KernelRunOptions } from "../../../src/kernel/state/kernel-state.js";

const SCHEMAS = [
  { name: "web-search", description: "search", parameters: [{ name: "q", type: "string", required: true }] },
];

const toolLayer = mockToolServiceLayer({
  execute: () => Effect.succeed({ success: true, result: { finding: "ok" } }),
  getTool: (name: string) =>
    Effect.succeed({ name, description: "test", parameters: [{ name: "q", type: "string", required: true }] }),
});

const search = (q: string) => ({ text: "", toolCalls: [{ name: "web-search", args: { q } }] });

type HookCtx = Parameters<PhaseHookFn<Phase>>[0];

const run = (harnessPipeline: HarnessPipeline, turns: Parameters<typeof TestLLMServiceLayer>[0]) =>
  Effect.runPromise(
    runPass(
      reactKernel,
      { task: "Search, then answer.", availableToolSchemas: SCHEMAS, contextProfile: { tier: "local" }, harnessPipeline } as KernelInput,
      { maxIterations: 6, strategy: "reactive", kernelType: "react", taskId: "per-turn-hook-state", modelId: "llama3.2:3b" } as KernelRunOptions,
    ).pipe(Effect.provide(Layer.mergeAll(TestLLMServiceLayer(turns), toolLayer, EventBusLive))),
  );

const pipelineOf = (reg: RegistrationHarness) =>
  new HarnessPipeline(reg._collected as ConstructorParameters<typeof HarnessPipeline>[0]);

const toolNameOf = (metadata: Record<string, unknown> | undefined): unknown => {
  const result = metadata?.["observationResult"];
  return typeof result === "object" && result !== null && "toolName" in result ? result.toolName : undefined;
};
const searchObservations = (s: HookCtx["state"]): number =>
  s.steps.filter((st) => st.type === "observation" && toolNameOf(st.metadata) === "web-search").length;

describe("per-turn hooks see the state of their moment", () => {
  it("after act / before observe / after observe see the tool round just run", async () => {
    const reg = new RegistrationHarness();
    const seen: { label: string; iteration: number; observations: number; usedSearch: boolean }[] = [];
    const record = (label: string) => (ctx: HookCtx) => {
      seen.push({
        label,
        iteration: ctx.iteration,
        observations: searchObservations(ctx.state),
        usedSearch: ctx.state.toolsUsed.has("web-search"),
      });
    };
    reg.after("act", record("after-act"));
    reg.before("observe", record("before-observe"));
    reg.after("observe", record("after-observe"));

    await run(pipelineOf(reg), [search("first"), search("second"), { text: "Done." }]);

    for (const label of ["after-act", "before-observe", "after-observe"]) {
      const rounds = seen.filter((s) => s.label === label);
      expect(rounds.length).toBeGreaterThanOrEqual(2);
      rounds.forEach((r, i) => {
        // round i has run i + 1 searches, and its own result is visible.
        expect(r.observations).toBe(i + 1);
        expect(r.usedSearch).toBe(true);
      });
    }
  });

  it("before think and after think report the same iteration for each turn", async () => {
    const reg = new RegistrationHarness();
    const before: number[] = [];
    const after: number[] = [];
    reg.before("think", (ctx) => { before.push(ctx.iteration); });
    reg.after("think", (ctx) => { after.push(ctx.iteration); });

    await run(pipelineOf(reg), [search("first"), { text: "Done." }]);

    expect(before.length).toBeGreaterThanOrEqual(2);
    expect(after).toEqual(before);
    // 0-indexed turn numbers, each turn once.
    expect(before[0]).toBe(0);
  });
});
