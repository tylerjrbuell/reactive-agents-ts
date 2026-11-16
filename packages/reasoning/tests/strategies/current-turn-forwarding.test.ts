// Run: bun test packages/reasoning/tests/strategies/current-turn-forwarding.test.ts --timeout 20000
//
// ReasoningService.execute({ currentTurnText }) reaches every contract compile
// through the RunEnvelope (rails.currentTurnText), so no strategy forwards it.
// RED-ON-CUT: drop the envelope fold in reasoning-service.ts, or the
// KernelInput fill in mergeRunEnvelopeIntoKernelInput, and the typed cells fail.
import { describe, it, expect } from "bun:test";
import { Effect, Layer, Ref } from "effect";
import { EventBus, EventBusLive, type AgentEvent } from "@reactive-agents/core";
import { toTraceEvent, type ContractCompiledEvent } from "@reactive-agents/trace";
import { TestLLMServiceLayer, type TestTurn } from "@reactive-agents/llm-provider";
import { createToolsLayer } from "@reactive-agents/tools";
import { ReasoningService, ReasoningServiceLive } from "../../src/services/reasoning-service.js";
import { StrategyRegistryLive } from "../../src/services/strategy-registry.js";
import { defaultReasoningConfig } from "../../src/types/config.js";
import type { ReasoningStrategy } from "../../src/types/index.js";
import {
  buildRunEnvelope,
  mergeRunEnvelopeIntoKernelInput,
  provideTestEnvelope,
  withCurrentTurnText,
} from "../../src/kernel/envelope/run-envelope.js";
import { openStrategyContract } from "../../src/kernel/contract/strategy-contract.js";

const CURRENT = "Thanks, what is the capital of France?";
const UNMARKED = `User: Write the report to ./old-report.md and send an email to the team.\nAssistant: Done.\n${CURRENT}`;

const contractIds = (strategy: ReasoningStrategy, turns: TestTurn[], typed: boolean): Promise<readonly (readonly string[])[]> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const events = yield* Ref.make<AgentEvent[]>([]);
      const bus = yield* EventBus;
      yield* bus.on("ContractCompiledEmitted", (ev) => Ref.update(events, (xs) => [...xs, ev]));
      const reasoning = yield* ReasoningService;
      yield* reasoning
        .execute({
          taskDescription: UNMARKED,
          ...(typed ? { currentTurnText: CURRENT } : {}),
          taskType: "query",
          memoryContext: "",
          availableTools: [],
          strategy,
          taskId: `ctt-${strategy}-${typed}`,
        })
        .pipe(Effect.catchAll(() => Effect.void));
      const raw = yield* Ref.get(events);
      return raw
        .map((r, i) => toTraceEvent(r, i))
        .filter((e): e is ContractCompiledEvent => e?.kind === "contract-compiled")
        .map((e) => e.requirements.map((r) => r.id));
    }).pipe(
      Effect.provide(
        Layer.provideMerge(
          ReasoningServiceLive(defaultReasoningConfig),
          Layer.mergeAll(TestLLMServiceLayer(turns), createToolsLayer(), StrategyRegistryLive, EventBusLive),
        ),
      ),
    ),
  );

describe("execute({ currentTurnText }) -> contract compile", () => {
  it("reactive: typed turn strips unmarked history; absent keeps it", async () => {
    const turns: TestTurn[] = [{ text: "FINAL ANSWER: Paris." }, { text: "FINAL ANSWER: Paris." }];
    const typed = await contractIds("reactive", turns, true);
    expect(typed.length).toBeGreaterThan(0);
    for (const ids of typed) expect(ids).toEqual(["answer"]);
    const untyped = await contractIds("reactive", turns, false);
    expect(untyped.flat()).toContain("artifact:./old-report.md");
  });
});

describe("envelope carrier", () => {
  it("withCurrentTurnText folds onto rails; absent leaves the same object; existing wins", () => {
    const env = buildRunEnvelope();
    expect(withCurrentTurnText(env, undefined)).toBe(env);
    const typed = withCurrentTurnText(env, CURRENT);
    expect(typed.rails.currentTurnText).toBe(CURRENT);
    expect(withCurrentTurnText(typed, "other").rails.currentTurnText).toBe(CURRENT);
    expect("currentTurnText" in env.rails).toBe(false);
  });

  it("merge fills KernelInput.currentTurnText only when absent", () => {
    const env = withCurrentTurnText(buildRunEnvelope(), CURRENT);
    expect(mergeRunEnvelopeIntoKernelInput({ task: UNMARKED }, env).currentTurnText).toBe(CURRENT);
    expect(mergeRunEnvelopeIntoKernelInput({ task: UNMARKED, currentTurnText: "own" }, env).currentTurnText).toBe("own");
    expect("currentTurnText" in mergeRunEnvelopeIntoKernelInput({ task: UNMARKED }, buildRunEnvelope())).toBe(false);
  });

  it("merge skips a sub-kernel whose own task does not carry the typed turn (plan step)", () => {
    const env = withCurrentTurnText(buildRunEnvelope(), CURRENT);
    expect("currentTurnText" in mergeRunEnvelopeIntoKernelInput({ task: "Add 2 and 3 with the add tool" }, env)).toBe(false);
  });

  it("openStrategyContract compiles from the envelope's typed turn", async () => {
    const open = (env = buildRunEnvelope()) =>
      Effect.runPromise(
        provideTestEnvelope(
          openStrategyContract({ task: UNMARKED, taskId: "ctt-open", toolService: { _tag: "None" } as never }),
          env,
        ).pipe(Effect.provide(EventBusLive)),
      );
    expect((await open(withCurrentTurnText(buildRunEnvelope(), CURRENT))).requirements.map((r) => r.id)).toEqual(["answer"]);
    expect((await open()).requirements.map((r) => r.id)).toContain("artifact:./old-report.md");
  });
});
