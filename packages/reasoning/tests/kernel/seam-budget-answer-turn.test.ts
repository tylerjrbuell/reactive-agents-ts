// Run: bun test packages/reasoning/tests/kernel/seam-budget-answer-turn.test.ts --timeout 20000
//
// Cortex runs 01M743KQ5KKKQQ9998SQGW9V66 (reactive, max 10: 23 tool calls, no
// answer) and 01M7447E9X95FGRB3H2RW81EWY: the last think call the iteration
// budget allows went to another tool call, so the run ended "stopped
// (max_iterations) before the model wrote a final answer". With validated
// evidence in hand and only the answer outstanding, that last call is now the
// exit gate's answer turn (no tools). The model writes the answer; the harness
// never does.
//
// OPT-IN (`harness.budgetAnswerTurn` / `RA_BUDGET_ANSWER_TURN=1`): ablation
// wiki/Research/Ablations/2026-11-10-budget-answer-turn-ablation.md measured
// +1.9pp over 3 tiers, within noise. Its three defects are pinned here:
//   1. a verified answer-turn reply ended `partial` / `max_iterations` (the cap
//      handed the answer off as a draft) instead of the model's final answer;
//   2. the reservation trusted an answer-only compiled contract and took the
//      tools away while the task still asked for an action (`report_file`);
//   3. a tool call on the 0-tool turn must never run.
//
// Two ways the last call becomes the answer turn:
//   - no guard fires: `reserveBudgetAnswerTurn` (turn-operations.ts `think`)
//     reserves it (flag-gated);
//   - a soft guard (stall, low-delta) proposes an exit at iteration max-1: the
//     gate's answer-turn deny-once fits there (`disposeExit` `answerOnly`),
//     because an answer turn never acts.
//
// RED-ON-CUT: drop the `reserveBudgetAnswerTurn` call in turn-operations.ts:
// (c) distinct-tools goes red. Set `answerOnly` to false in exit-gate.ts
// `proposeExit`: (c) repeated-tool goes red (the stall guard hands off, failed).
// Drop the `budgetAnswerTurnTaken` deferral in `proposeExit`: the deferral case
// goes red (an RI early stop in the answer-turn pass ended the run as
// `dispatcher_early_stop` → `guard_stop` instead of the cap's `max_iterations`).
// Drop the flag check in `budgetAnswerTurnRecord`: the flag-off cases go red.
// Drop `answerTurnReplyExit` in `proposeCapExit`: the cap mislabel cases go red.
// Drop the `requestedActionTools` check in `budgetAnswerTurnRecord`: the
// requested-action case goes red. The 0-tool-turn cases are behavior pins:
// cutting only the `withheldTurnCalledTool` refusal in think.ts does NOT turn
// them red (measured 2026-11-10). On the budget's last call the loop bound
// also stops the call, and mid-run another layer refuses it too.
import { afterEach, describe, expect, it } from "bun:test";
import { Effect, Layer, Stream } from "effect";
import { LLMService, TestLLMService, type LLMErrors, type StreamEvent, type TestTurn } from "@reactive-agents/llm-provider";
import { budgetAnswerTurnRecord, isLastThinkCall, reserveBudgetAnswerTurn } from "../../src/kernel/loop/budget-answer-turn.js";
import { budgetAnswerTurnTaken, DISPATCHER_EARLY_STOP, proposeCapExit, proposeExit } from "../../src/kernel/loop/exit-gate.js";
import { requestedActionTools } from "../../src/kernel/capabilities/verify/claimed-actions.js";
import { EventBusLive, harnessSynthesisDeliverable } from "@reactive-agents/core";
import { makeStep } from "../../src/kernel/capabilities/sense/step-utils.js";
import { makeObservationResult } from "../../src/kernel/utils/observation-helpers.js";
import { makeKernelInput, makeKernelRunOptions, makeKernelState } from "../../src/testing/kernel-fixtures.js";
import type { KernelInput, KernelState } from "../../src/kernel/state/kernel-state.js";
import { executeReactive } from "../../src/strategies/reactive.js";
import { defaultReasoningConfig } from "../../src/types/config.js";
import { failingToolLayer, mockToolServiceLayer, succeedingToolLayer } from "../../src/testing/tool-service-mock.js";
import { buildRunEnvelope, provideTestEnvelope } from "../../src/kernel/envelope/run-envelope.js";
import { resolveHarnessConfig } from "../../src/harness-config.js";

const TASK = "Look up the regional sales figures and tell me which region grew fastest.";
const EVIDENCE = "north=+14%; south=+9%; west=+6%";
const ANSWER = "The north region grew fastest last quarter, at 14%, ahead of the south (9%) and the west (6%).";
const PARAMS = [{ name: "q", type: "string", required: true }];
const schema = (name: string) => ({ name, description: `gather ${name} data`, parameters: PARAMS });

/** The mechanism's switch, on. */
const ON = resolveHarnessConfig({ budgetAnswerTurn: true });
const inputOn = (overrides: Partial<KernelInput> = {}) => makeKernelInput({ task: TASK, harness: ON, ...overrides });

const gathered = [
  makeStep("action", "gather({})", { toolCall: { id: "g1", name: "gather", arguments: { q: "sales" } } }),
  makeStep("observation", EVIDENCE, { toolCallId: "g1", observationResult: makeObservationResult("gather", true, EVIDENCE) }),
];

const stateAt = (iteration: number, steps = gathered): KernelState => {
  const toolsUsed = new Set(steps.flatMap((s) => (s.metadata?.toolCall ? [s.metadata.toolCall.name] : [])));
  return makeKernelState({ status: "thinking", iteration, llmCalls: iteration, toolsUsed: toolsUsed.size > 0 ? toolsUsed : new Set(["gather"]), steps } as never);
};

describe("the budget answer turn is opt-in", () => {
  const saved = process.env.RA_BUDGET_ANSWER_TURN;
  afterEach(() => {
    if (saved === undefined) delete process.env.RA_BUDGET_ANSWER_TURN;
    else process.env.RA_BUDGET_ANSWER_TURN = saved;
  });

  it("resolves off by default, on from config or RA_BUDGET_ANSWER_TURN=1, and config beats env", () => {
    delete process.env.RA_BUDGET_ANSWER_TURN;
    expect("budgetAnswerTurn" in resolveHarnessConfig()).toBe(false);
    expect(resolveHarnessConfig({ budgetAnswerTurn: true }).budgetAnswerTurn).toBe(true);
    process.env.RA_BUDGET_ANSWER_TURN = "1";
    expect(resolveHarnessConfig().budgetAnswerTurn).toBe(true);
    expect("budgetAnswerTurn" in resolveHarnessConfig({ budgetAnswerTurn: false })).toBe(false);
  });

  it("flag unset: no reservation, the state is unchanged, and budgetAnswerTurnTaken stays false", async () => {
    const input = makeKernelInput({ task: TASK, harness: resolveHarnessConfig({}) });
    expect(budgetAnswerTurnRecord(stateAt(9), input, 10)).toBeUndefined();
    const state = stateAt(9);
    const after = await Effect.runPromise(
      reserveBudgetAnswerTurn({ state, input, maxIterations: 10, taskId: "t" }).pipe(Effect.provide(EventBusLive)),
    );
    expect(after).toBe(state);
    expect(budgetAnswerTurnTaken(makeKernelState({ ...after, llmCalls: 10, iteration: 10 } as never), 10)).toBe(false);
  });

  it("no harness on the input at all: no reservation", () => {
    expect(budgetAnswerTurnRecord(stateAt(9), makeKernelInput({ task: TASK }), 10)).toBeUndefined();
  });
});

describe("budgetAnswerTurnRecord: when the last think call is reserved for the answer (flag on)", () => {
  it("isLastThinkCall: the call at max-1 (either counter) is the last one", () => {
    expect(isLastThinkCall({ iteration: 9, llmCalls: 9 }, 10)).toBe(true);
    expect(isLastThinkCall({ iteration: 3, llmCalls: 9 }, 10)).toBe(true);
    expect(isLastThinkCall({ iteration: 8, llmCalls: 8 }, 10)).toBe(false);
  });

  it("reserves the last call when evidence exists and only the answer is outstanding", () => {
    const record = budgetAnswerTurnRecord(stateAt(9), inputOn(), 10);
    expect(record?.gateDecision).toBe("deny-once");
    expect(record?.answerTurnAt).toBe(9);
    expect(record?.outstanding.length).toBeGreaterThan(0);
  });

  it("does not reserve an earlier call", () => {
    expect(budgetAnswerTurnRecord(stateAt(8), inputOn(), 10)).toBeUndefined();
  });

  it("(d) does not reserve without validated evidence", () => {
    expect(budgetAnswerTurnRecord(stateAt(9, []), inputOn(), 10)).toBeUndefined();
  });

  it("does not reserve while a required tool is uncalled (the last call keeps its tools)", () => {
    expect(budgetAnswerTurnRecord(stateAt(9), inputOn({ requiredTools: ["file-write"] }), 10)).toBeUndefined();
  });
});

describe("defect 2: an action the task asks for keeps the last call's tools (answer-only contract is not trusted)", () => {
  // Ablation task `wide-metric`: the compiled contract held only [{id:"answer"}],
  // so the reservation fired and grok returned success without filing the report (6/6).
  const WIDE = "Fetch the current metric named 'latency_p99' using the metrics tool, then file a report containing that exact value using the report tool. Your final answer MUST state the metric value.";
  const tools = ["metrics_fetch", "report_file", "jira_issue_create", "slack_post_message"];
  const METRIC = `{"metric":"latency_p99","value_ms":873,"window":"5m","source":"prometheus","status":"ok"}`;
  const FILED = "report filed (id RPT-41, 64 chars): latency_p99 is 873 ms over the last 5 minutes";
  const fetched = [
    makeStep("action", "metrics_fetch({})", { toolCall: { id: "m1", name: "metrics_fetch", arguments: { name: "latency_p99" } } }),
    makeStep("observation", METRIC, { toolCallId: "m1", observationResult: makeObservationResult("metrics_fetch", true, METRIC) }),
  ];
  const filed = [
    makeStep("action", "report_file({})", { toolCall: { id: "r1", name: "report_file", arguments: { body: "873" } } }),
    makeStep("observation", FILED, { toolCallId: "r1", observationResult: makeObservationResult("report_file", true, FILED) }),
  ];
  const input = inputOn({ task: WIDE, availableToolSchemas: tools.map(schema) });

  it("requestedActionTools names the uncalled tool the task asks to use", () => {
    expect(requestedActionTools(WIDE, tools, new Set(["metrics_fetch"]))).toEqual(["report_file"]);
    expect(requestedActionTools(WIDE, tools, new Set(["metrics_fetch", "report_file"]))).toEqual([]);
    expect(requestedActionTools(TASK, tools, new Set())).toEqual([]);
  });

  it("a negated request is not a request", () => {
    expect(requestedActionTools("Fetch latency_p99 and do not file a report.", tools, new Set())).toEqual([]);
  });

  it("does not reserve while the requested report is unfiled; reserves once it is filed", () => {
    // Control: same evidence, no report tool on the surface → the reservation fires.
    const noReportTool = inputOn({ task: WIDE, availableToolSchemas: [schema("metrics_fetch")] });
    expect(budgetAnswerTurnRecord(stateAt(9, fetched), noReportTool, 10)?.answerTurnAt).toBe(9);
    expect(budgetAnswerTurnRecord(stateAt(9, fetched), input, 10)).toBeUndefined();
    expect(budgetAnswerTurnRecord(stateAt(9, [...fetched, ...filed]), input, 10)?.answerTurnAt).toBe(9);
  });
});

describe("after the budget answer turn, only the cap ends the run", () => {
  const reserved = makeStep("harness_signal", "exit gate", {
    exitGate: { proposedBy: "max_iterations", gateDecision: "deny-once", reason: "max_iterations", outstanding: ["write the final answer"], answerTurnAt: 1 },
  });
  const afterAnswerTurn = makeKernelState({ status: "thinking", iteration: 1, llmCalls: 2, steps: [...gathered, reserved] } as never);
  const softExit = (state: KernelState) =>
    Effect.runPromise(
      proposeExit({
        state,
        proposal: { ...DISPATCHER_EARLY_STOP, deliverable: harnessSynthesisDeliverable([], undefined, "") },
        input: makeKernelInput({ task: TASK }),
        maxIterations: 2,
        taskId: "t",
      }).pipe(Effect.provide(EventBusLive)),
    );

  it("budgetAnswerTurnTaken: true once the reserved call was made and no call is left", () => {
    expect(budgetAnswerTurnTaken(afterAnswerTurn, 2)).toBe(true);
    expect(budgetAnswerTurnTaken(makeKernelState({ ...afterAnswerTurn, llmCalls: 1 } as never), 2)).toBe(false);
  });

  it("a soft guard (RI early stop) in that pass is deferred to the cap: the run stays non-terminal", async () => {
    const { decision, state } = await softExit(afterAnswerTurn);
    expect(decision).toBe("deny");
    expect(state.status).toBe("thinking");
    expect(state.steps.length).toBe(afterAnswerTurn.steps.length);
  });

  describe("defect 1: the cap ends a verified answer-turn reply as the model's final answer", () => {
    const answered = makeKernelState({
      ...afterAnswerTurn,
      iteration: 2,
      steps: [...afterAnswerTurn.steps, makeStep("thought", ANSWER)],
    } as never);
    const cap = (state: KernelState, input: KernelInput = makeKernelInput({ task: TASK })) =>
      Effect.runPromise(
        proposeCapExit({ state, currentInput: input, currentOptions: makeKernelRunOptions({ maxIterations: 2 }) }).pipe(
          Effect.provide(EventBusLive),
        ),
      );

    it("the RI early stop deferred to the cap, then the cap: completed, model-final, not partial/max_iterations", async () => {
      const deferred = await softExit(answered);
      expect(deferred.decision).toBe("deny");
      const ended = await cap(deferred.state);
      expect(ended.status).toBe("done");
      expect(ended.meta.terminatedBy).toBe("final_answer");
      expect(String(ended.output ?? "")).toBe(ANSWER);
      expect(ended.meta.deliverableDecision?.accepted).not.toBe(false);
      expect(String(ended.output ?? "")).not.toContain("Unfinished:");
    });

    it("an answer turn with no answer written still goes to the cap's handoff (unchanged)", async () => {
      const ended = await cap(afterAnswerTurn);
      expect(ended.meta.terminatedBy).not.toBe("final_answer");
    });

    it("work still outstanding (a required tool uncalled): the reply is not a final answer", async () => {
      const ended = await cap(answered, makeKernelInput({ task: TASK, requiredTools: ["file-write"] }));
      expect(ended.meta.terminatedBy).not.toBe("final_answer");
    });

    it("no answer turn was taken: the cap's own outcome stands (the reply is not promoted)", async () => {
      const noTurn = makeKernelState({ ...answered, steps: [...gathered, makeStep("thought", ANSWER)] } as never);
      const ended = await cap(noTurn);
      expect(ended.meta.terminatedBy).not.toBe("final_answer");
    });
  });
});

/**
 * A model that calls `names[i]` on its i-th tool-offered call and answers with
 * `answerTurn` when no tools are offered. Usage grows 1,000 tokens a call so
 * the low-delta guard never fires.
 */
function gatherUntilToolless(names: readonly string[], answerTurn: TestTurn = { text: ANSWER }) {
  const toolTurns: TestTurn[] = names.map((name, i) => ({ toolCall: { id: `g-${i}`, name, args: { q: `q${i}` } } }));
  const tools = TestLLMService(toolTurns);
  const answer = TestLLMService([answerTurn]);
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
      complete: (req) => answer.complete(req),
      stream: (req) => {
        const n = req.tools?.length ?? 0;
        offered.push(n);
        return (n === 0 ? answer.stream(req) : tools.stream(req)).pipe(Effect.map((s) => grow(s, offered.length)));
      },
    }),
  );
  return { offered, layer };
}

/** A run budget of 4 iterations, user-declared (so no tier hint overrides it). */
const BUDGET_4 = {
  ...defaultReasoningConfig,
  strategies: {
    ...defaultReasoningConfig.strategies,
    reactive: { ...defaultReasoningConfig.strategies.reactive, maxIterations: 4, maxIterationsExplicit: true },
  },
};

const DISTINCT = ["gather_north", "gather_south", "gather_west", "gather_east", "gather_misc"];
const REPEATED = ["gather", "gather", "gather", "gather", "gather"];

const run = (
  names: readonly string[],
  toolLayer: ReturnType<typeof succeedingToolLayer>,
  opts: { readonly budgetAnswerTurn?: boolean; readonly answerTurn?: TestTurn } = {},
) => {
  const llm = gatherUntilToolless(names, opts.answerTurn);
  const schemas = [...new Set(names)].map(schema);
  const envelope = buildRunEnvelope({ harness: { budgetAnswerTurn: opts.budgetAnswerTurn ?? true } });
  return Effect.runPromise(
    provideTestEnvelope(
      executeReactive({
        taskDescription: TASK,
        taskType: "research",
        memoryContext: "",
        availableTools: schemas.map((s) => s.name),
        availableToolSchemas: schemas,
        config: BUDGET_4,
      } as never).pipe(Effect.provide(Layer.merge(llm.layer, toolLayer))),
      envelope,
    ),
  ).then((result) => ({ result, offered: llm.offered }));
};

const evidenceLayer = () => succeedingToolLayer({ finding: EVIDENCE }, PARAMS);

/** A succeeding tool layer that counts executions. */
const countingLayer = () => {
  const executed: string[] = [];
  const layer = mockToolServiceLayer({
    execute: (req) => Effect.sync(() => (executed.push(req.toolName), { success: true, result: { finding: EVIDENCE } })),
    getTool: (name: string) => Effect.succeed({ name, description: "test", parameters: PARAMS }),
  });
  return { executed, layer };
};

describe("end to end: the run's last think call is the model's answer turn", () => {
  for (const [label, names] of [["distinct tools (reservation)", DISTINCT], ["repeated tool (stall guard at max-1)", REPEATED]] as const) {
    it(`(c) ${label}: the final call ships no tools and the model's text is the output`, async () => {
      const { result, offered } = await run(names, evidenceLayer());
      expect(offered.length).toBe(4);
      expect(offered.at(-1)).toBe(0);
      expect(offered.slice(0, -1).every((n) => n > 0)).toBe(true);
      expect(["completed", "partial"]).toContain(result.status);
      expect(String(result.output ?? "")).toContain(ANSWER);
    }, 20000);
  }

  it("flag off: the reservation does not fire, every call keeps its tools", async () => {
    const { offered } = await run(DISTINCT, evidenceLayer(), { budgetAnswerTurn: false });
    expect(offered.length).toBe(4);
    expect(offered.every((n) => n > 0)).toBe(true);
  }, 20000);

  it("(d) without evidence (every tool call failed): tools stay offered and the run fails honestly", async () => {
    const { result, offered } = await run(DISTINCT, failingToolLayer("upstream unavailable"));
    expect(offered.every((n) => n > 0)).toBe(true);
    expect(result.status).toBe("failed");
    expect(String(result.output ?? "")).not.toContain(ANSWER);
  }, 20000);

  it("defect 3, mid-run: a stall-guard answer turn with calls left still never runs a call made on it", async () => {
    // The budget's own answer turn is the last call, so the loop bound alone
    // would stop its call; here the answer turn comes with calls to spare, so
    // only the refusal layers keep the call from running.
    const executedArgs: unknown[] = [];
    const layer = mockToolServiceLayer({
      execute: (req) => Effect.sync(() => (executedArgs.push(req.args), { success: true, result: { finding: EVIDENCE } })),
      getTool: (name: string) => Effect.succeed({ name, description: "test", parameters: PARAMS }),
    });
    const llm = gatherUntilToolless(REPEATED.concat(REPEATED), { toolCall: { id: "late", name: "gather", args: { q: "late" } }, text: "" });
    const budget8 = { ...BUDGET_4, strategies: { ...BUDGET_4.strategies, reactive: { ...BUDGET_4.strategies.reactive, maxIterations: 8 } } };
    await Effect.runPromise(
      provideTestEnvelope(
        executeReactive({
          taskDescription: TASK, taskType: "research", memoryContext: "",
          availableTools: ["gather"], availableToolSchemas: [schema("gather")], config: budget8,
        } as never).pipe(Effect.provide(Layer.merge(llm.layer, layer))),
        buildRunEnvelope({ harness: { budgetAnswerTurn: true } }),
      ),
    );
    const answerTurnAt = llm.offered.indexOf(0);
    expect(answerTurnAt).toBeGreaterThanOrEqual(0);
    expect(answerTurnAt).toBeLessThan(7); // not the budget's last call: the loop bound would let a call run
    expect(executedArgs).not.toContainEqual({ q: "late" });
  }, 20000);

  describe("defect 3: a tool call on the 0-tool answer turn never runs", () => {
    const calls = [
      ["native call", { toolCall: { id: "late", name: "gather_east", args: { q: "late" } }, text: ANSWER }],
      ["text-printed call", { text: `<tool_call>{"name":"gather_east","arguments":{"q":"late"}}</tool_call>` }],
    ] as const;
    for (const [label, answerTurn] of calls) {
      it(`${label}: no fourth tool execution, no action step for it`, async () => {
        const tools = countingLayer();
        const { result, offered } = await run(DISTINCT, tools.layer, { answerTurn });
        expect(offered.at(-1)).toBe(0);
        expect(tools.executed).toEqual(["gather_north", "gather_south", "gather_west"]);
        const ledger = (result.metadata as { runLedger?: readonly { kind: string; toolName?: string }[] }).runLedger ?? [];
        expect(ledger.filter((e) => e.kind === "tool-invocation").map((e) => e.toolName)).not.toContain("gather_east");
      }, 20000);
    }
  });
});
