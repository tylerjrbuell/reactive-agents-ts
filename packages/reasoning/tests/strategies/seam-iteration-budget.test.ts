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
import { Effect, Layer, Stream } from "effect";
import { LLMService, TestLLMService, type LLMErrors, type StreamEvent, type TestTurn } from "@reactive-agents/llm-provider";
import { passIterationShare, passIterationsUsed } from "../../src/strategies/budget/iteration-budget.js";
import { executeReflexion } from "../../src/strategies/reflexion.js";
import { defaultReasoningConfig, type ReasoningConfig } from "../../src/types/config.js";
import { succeedingToolLayer } from "../../src/testing/tool-service-mock.js";
import { provideTestEnvelope } from "../../src/kernel/envelope/run-envelope.js";

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
    ),
  ).then((result) => ({ result, offered: model.offered }));
};

describe("reflexion draws on the run's iteration budget", () => {
  it("(a) maxIterations 20: the generate pass is not capped at 3 (its share is 5)", async () => {
    const { result, offered } = await runReflexion(configWith(20));
    const toolCallsBeforeAnswer = offered.findIndex((n) => n === 0);
    expect(toolCallsBeforeAnswer).toBe(4); // 5 iterations: 4 tool calls, then the answer turn
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
