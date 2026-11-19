// Run: bun test packages/reasoning/tests/strategies/seam-iteration-budget.test.ts --timeout 20000
//
// Cortex runs 01M7447E9X95FGRB3H2RW81EWY / 01M743ZKKXCA3D1TQYNQA1H65A
// (reflexion, maxIterations 20): every reflexion kernel pass ran with a fixed
// `kernelMaxIterations ?? 3`, so the generate pass stopped after 3 iterations
// whatever the user's budget, and its max_iterations failure capped the run
// at `partial` even when a later pass delivered. Now:
//   (a) each pass draws a share of the run's remaining iteration budget
//       (`strategies/budget/iteration-budget.ts`, `run.iterationShare`);
//   (b) a pass that ends failed at its own cap hands its evidence back: the
//       strategy proceeds and the run is not failed (`capStatusToEnvelope`
//       caps a sub-pass failure at `partial`; regression pin, pre-existing).
//
// RED-ON-CUT: restore `kernelMaxIterations ?? 3` at reflexion.ts's generate
// pass: (a) goes red.
import { describe, expect, it } from "bun:test";
import { Effect, Layer, Ref, Stream } from "effect";
import { EventBus, EventBusLive, type AgentEvent } from "@reactive-agents/core";
import { STRATEGY_ACCEPTED_AUTHORITY } from "../../src/kernel/state/terminal-authority.js";
import { LLMService, TestLLMService, type LLMErrors, type StreamEvent, type TestTurn } from "@reactive-agents/llm-provider";
import { passIterationShare, passIterationsUsed } from "../../src/strategies/budget/iteration-budget.js";
import { executeReflexion } from "../../src/strategies/reflexion.js";
import { defaultReasoningConfig, type ReasoningConfig } from "../../src/types/config.js";
import { succeedingToolLayer } from "../../src/testing/tool-service-mock.js";
import { buildRunEnvelope, provideTestEnvelope } from "../../src/kernel/envelope/run-envelope.js";

describe("passIterationShare: a pass's share of the run's iteration budget", () => {
  it("splits what is left evenly over the passes that may still run", () => {
    expect(passIterationShare({ run: 20 }, 0, 4)).toBe(5);
    expect(passIterationShare({ run: 10 }, 0, 4)).toBe(3);
    expect(passIterationShare({ run: 20 }, 5, 3)).toBe(5);
  });

  it("an explicit per-pass cap wins", () => {
    expect(passIterationShare({ run: 20, perPass: 2 }, 0, 4)).toBe(2);
  });

  it("shares recomputed before each pass never exceed the run budget", () => {
    let spent = 0;
    for (let left = 4; left > 0; left--) spent += passIterationShare({ run: 10 }, spent, left);
    expect(spent).toBe(10);
  });

  it("never drops below the floor", () => {
    expect(passIterationShare({ run: 10, floor: 5 }, 0, 4)).toBe(5);
    // A pass always gets one think+act round and one answer turn (MIN_PASS_ITERATIONS).
    expect(passIterationShare({ run: 4 }, 0, 4)).toBe(2);
    expect(passIterationShare({ run: 2 }, 2, 2)).toBe(2);
  });

  it("a lead pass draws half of what is left when that beats the even share; later passes split the rest", () => {
    expect(passIterationShare({ run: 16 }, 0, 4, { lead: true })).toBe(8); // trace 01M7T3GGGZTYN79G1T0JSW4G5V got 4
    expect(passIterationShare({ run: 16 }, 8, 3)).toBe(3);
    expect(passIterationShare({ run: 10 }, 0, 2, { lead: true })).toBe(5); // two passes: same as even
    expect(passIterationShare({ run: 20, perPass: 3 }, 0, 4, { lead: true })).toBe(3); // explicit per-pass cap still wins
    expect(passIterationShare({ run: 3 }, 0, 4, { lead: true })).toBe(2); // floor still holds
  });

  it("a pass used its loop counter or its LLM calls, whichever is higher", () => {
    expect(passIterationsUsed({ iteration: 2, llmCalls: 3 })).toBe(3);
  });
});

const TASK = "Look up the regional sales figures and tell me which region grew fastest.";
const EVIDENCE = "north=+14%; south=+9%; west=+6%";
const ANSWER = "The north region grew fastest last quarter, at 14%, ahead of the south (9%) and the west (6%).";
const PARAMS = [{ name: "q", type: "string", required: true }];
const NAMES = ["gather_north", "gather_south", "gather_west", "gather_east", "gather_misc", "gather_extra", "gather_more", "gather_last"];
const SCHEMAS = NAMES.map((name) => ({ name, description: `gather ${name} data`, parameters: PARAMS }));

/**
 * Calls a distinct tool on every tool-offered think call, answers when no tools
 * are offered, and SATISFIES every critique. Usage grows so the low-delta guard
 * never fires.
 */
function reflexionModel(opts: { readonly silentAnswerTurn?: boolean } = {}) {
  const toolTurns: TestTurn[] = NAMES.map((name, i) => ({ toolCall: { id: `g-${i}`, name, args: { q: `q${i}` } } }));
  const tools = TestLLMService(toolTurns);
  const answer = TestLLMService([{ text: ANSWER }]);
  // `silentAnswerTurn`: a tool-less think call writes nothing (direct calls still answer).
  const toolless = opts.silentAnswerTurn === true ? TestLLMService([{ text: "" }]) : answer;
  const critique = TestLLMService([{ text: "SATISFIED: the response fully addresses the task." }]);
  const offered: number[] = [];
  const grow = (stream: Stream.Stream<StreamEvent, LLMErrors>, call: number) =>
    Stream.map(stream, (ev): StreamEvent =>
      ev.type === "usage"
        ? { type: "usage", usage: { inputTokens: 1000 * call, outputTokens: 50, totalTokens: 1000 * call + 50, estimatedCost: 0 } }
        : ev,
    );
  const layer = Layer.succeed(
    LLMService,
    LLMService.of({
      ...tools,
      complete: (req) => ((req.systemPrompt ?? "").includes("critical evaluator") ? critique : answer).complete(req),
      stream: (req) => {
        const n = req.tools?.length ?? 0;
        offered.push(n);
        return (n === 0 ? toolless.stream(req) : tools.stream(req)).pipe(Effect.map((s) => grow(s, offered.length)));
      },
    }),
  );
  return { offered, layer };
}

const configWith = (maxIterations: number, kernelMaxIterations?: number): ReasoningConfig => ({
  ...defaultReasoningConfig,
  strategies: {
    ...defaultReasoningConfig.strategies,
    reactive: { ...defaultReasoningConfig.strategies.reactive, maxIterations, maxIterationsExplicit: true },
    reflexion: {
      ...defaultReasoningConfig.strategies.reflexion,
      ...(kernelMaxIterations !== undefined ? { kernelMaxIterations } : {}),
    },
  },
});

// Both cases run with the budget answer turn on (default since 2026-11-19). It
// reserves only the run's last call, so a pass's share ends with its tools on.
const runReflexion = (config: ReasoningConfig, opts: { readonly silentAnswerTurn?: boolean } = {}) => {
  const model = reflexionModel(opts);
  return Effect.runPromise(
    provideTestEnvelope(
      executeReflexion({
        taskDescription: TASK,
        taskType: "research",
        memoryContext: "",
        availableTools: NAMES,
        availableToolSchemas: SCHEMAS,
        config,
      } as never).pipe(Effect.provide(Layer.merge(model.layer, succeedingToolLayer({ finding: EVIDENCE }, PARAMS)))),
      buildRunEnvelope({ harness: { budgetAnswerTurn: true } }),
    ),
  ).then((result) => ({ result, offered: model.offered }));
};

describe("reflexion draws on the run's iteration budget", () => {
  it("(a) maxIterations 12: the generate pass is not capped at 3 (it leads: its share is 6)", async () => {
    const { result, offered } = await runReflexion(configWith(12));
    // 6 iterations: six tool-offered calls. The pass cap is not the run's, so
    // its last call keeps its tools (since 2026-11-19 the budget answer turn
    // reserves only the RUN's last call) and a later pass answers.
    expect(offered.length).toBe(6);
    expect(offered.every((n) => n > 0)).toBe(true);
    expect(String(result.output ?? "")).toContain(ANSWER);
  }, 20000);

  it("(b) a generate pass that hits its own cap does not fail the run: the strategy proceeds on its evidence", async () => {
    // kernelMaxIterations 2: the generate pass gathers, its answer turn writes
    // nothing, and its cap ends it failed with evidence and no draft (the
    // 01M743ZKKXCA3D1TQYNQA1H65A shape). Reflexion seeds its loop from that
    // evidence (its synthesis call) and the critique is satisfied.
    const { result } = await runReflexion(configWith(20, 2), { silentAnswerTurn: true });
    expect(result.status).toBe("partial");
    expect(String(result.output ?? "")).toContain(ANSWER);
  }, 20000);
});

// Cortex trace 01M7T3GGGZTYN79G1T0JSW4G5V (reflexion, gemini-flash-latest,
// maxIterations 16, maxRetries 3): the generate pass got an even quarter of the
// run (4 iterations), spent them on todo bookkeeping and two tool calls, and
// hit its cap mid-tool-work with no draft. Reflexion synthesized a full report
// from its evidence and the critique said SATISFIED, but the generate pass's
// unmet `answer` floor still stood (as `outstandingCriteria` and as a declared,
// never-satisfied ledger requirement), so the runtime vetoed the run to
// failure ("unmet requirements: answer"). Now:
//   (c) the generate pass leads: it draws half the run budget (8 of 16);
//   (d) the critique's acceptance is the `answer` floor's self-critique verdict,
//       so a pass that hit its own cap no longer leaves `answer` outstanding.
//
// RED-ON-CUT (verified 2026-11-19): drop `{ lead: true }` at reflexion.ts's
// generate pass: (a) and (c) go red. Drop `answerAccepted` from reflexion's
// Result, or skip `ledgerWithAcceptedAnswer` in the substrate: (d) goes red.
describe("reflexion: a generate pass capped mid-tool-work hands off, it does not fail the run", () => {
  const MANY = Array.from({ length: 14 }, (_, i) => `gather_${i}`);
  const MANY_SCHEMAS = MANY.map((name) => ({ name, description: `gather ${name} data`, parameters: PARAMS }));

  /** Calls a distinct tool on every tool-offered think call (never answers in the pass); synthesis answers; critique SATISFIED. */
  function neverAnsweringModel() {
    const tools = TestLLMService(MANY.map((name, i) => ({ toolCall: { id: `m-${i}`, name, args: { q: `q${i}` } } })));
    const answer = TestLLMService([{ text: ANSWER }]);
    const critique = TestLLMService([{ text: "SATISFIED: the response fully addresses the task." }]);
    const offered: number[] = [];
    const layer = Layer.succeed(
      LLMService,
      LLMService.of({
        ...tools,
        complete: (req) => ((req.systemPrompt ?? "").includes("critical evaluator") ? critique : answer).complete(req),
        stream: (req) => {
          const n = req.tools?.length ?? 0;
          offered.push(n);
          return (n === 0 ? answer.stream(req) : tools.stream(req)).pipe(
            Effect.map((s) =>
              Stream.map(s, (ev): StreamEvent =>
                ev.type === "usage"
                  ? { type: "usage", usage: { inputTokens: 1000 * offered.length, outputTokens: 50, totalTokens: 1000 * offered.length + 50, estimatedCost: 0 } }
                  : ev,
              ),
            ),
          );
        },
      }),
    );
    return { offered, layer };
  }

  const run = () => {
    const model = neverAnsweringModel();
    return Effect.runPromise(
      provideTestEnvelope(
        executeReflexion({
          taskDescription: TASK,
          taskType: "research",
          memoryContext: "",
          availableTools: MANY,
          availableToolSchemas: MANY_SCHEMAS,
          config: configWith(16),
        } as never).pipe(Effect.provide(Layer.merge(model.layer, succeedingToolLayer({ finding: EVIDENCE }, PARAMS)))),
        buildRunEnvelope({}),
      ),
    ).then((result) => ({ result, offered: model.offered }));
  };

  it("(c) maxIterations 16, maxRetries 3: the generate pass draws half the run (8 think calls), not a quarter (4)", async () => {
    const { offered } = await run();
    // Every generate-pass think call offered tools and called one; the critique was satisfied, so no improve pass ran.
    expect(offered.length).toBe(8);
  }, 20000);

  it("(d) the critique-accepted answer clears the `answer` floor: no outstanding answer, ledger answer satisfied, not failed", async () => {
    const { result } = await run();
    expect(result.status).toBe("partial"); // the generate pass was budget-capped: honest partial, never failed
    expect(String(result.output ?? "")).toContain(ANSWER);
    const meta = result.metadata as Record<string, unknown> & { readonly extensions?: { readonly terminalOutcome?: { readonly answerSatisfied?: boolean | null; readonly outstanding?: readonly string[] } } };
    expect((meta.outstandingCriteria as readonly string[] | undefined) ?? []).not.toContain("answer");
    expect(meta.extensions?.terminalOutcome?.answerSatisfied).toBe(true);
    expect(meta.extensions?.terminalOutcome?.outstanding).toBeDefined();
    expect(meta.extensions?.terminalOutcome?.outstanding).not.toContain("answer");
  }, 20000);

  // (e) harness report 2026-11-19 (trace 01M7T8TY…): the acceptance decided the
  // run, yet the outcome said `strategy-exhausted` (the capped pass's terminator)
  // and the last `terminal_decision` on the trace was that pass's. The outcome
  // names the acceptance, and the strategy records its own terminal decision.
  // RED-ON-CUT: drop the `answerAccepted` marker in strategy-run.ts's mint, or the
  // `strategy-accepted` arm in finalize-result.ts: (e) goes red.
  it("(e) the acceptance owns the outcome authority and records one strategy-level terminal_decision", async () => {
    const model = neverAnsweringModel();
    const { result, decisions } = await Effect.runPromise(
      Effect.gen(function* () {
        const seen = yield* Ref.make<AgentEvent[]>([]);
        const bus = yield* EventBus;
        yield* bus.subscribe((ev) => Ref.update(seen, (xs) => [...xs, ev]));
        const result = yield* provideTestEnvelope(
          executeReflexion({
            taskDescription: TASK,
            taskType: "research",
            memoryContext: "",
            availableTools: MANY,
            availableToolSchemas: MANY_SCHEMAS,
            config: configWith(16),
          } as never),
          buildRunEnvelope({}),
        );
        const decisions = (yield* Ref.get(seen)).flatMap((e) =>
          e._tag === "GuardFiredEmitted" && e.guard === "terminal_decision" ? [e] : [],
        );
        return { result, decisions };
      }).pipe(Effect.provide(Layer.mergeAll(model.layer, succeedingToolLayer({ finding: EVIDENCE }, PARAMS), EventBusLive))),
    );
    const outcome = (result.metadata as { readonly extensions?: { readonly terminalOutcome?: { readonly authority?: string } } })
      .extensions?.terminalOutcome;
    expect(outcome?.authority).toBe(STRATEGY_ACCEPTED_AUTHORITY);
    const last = decisions.at(-1);
    expect(last?.metadata?.["authority"]).toBe(STRATEGY_ACCEPTED_AUTHORITY);
    expect(last?.metadata?.["finalStatus"]).toBe(result.status);
    expect(last?.metadata?.["status"]).toBe("done");
  }, 20000);
});
