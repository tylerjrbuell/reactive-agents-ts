// Run: bun test packages/reasoning/tests/kernel/seam-lean-final-turn.test.ts --timeout 20000
//
// Seam pin for kernel/capabilities/reason/lean-final-turn.ts (harness switch
// `leanFinalTurn`, default OFF). Golden-run diagnosis 2026-11-18: the answer
// turn after the last required tool call cost 26% of tokens and 34% of LLM
// time while still shipping every tool schema and a thinking chain. With the
// switch on, once the contract's tool work is settled the next think call ships
// no tools, `thinking: false`, and the think budget without the thinking
// allowance. Zero tokens: a scripted model and tool service.
//
// RED-ON-CUT: drop `|| lean.taken` from `withholdTools` in think.ts: the "on"
// case goes red (tools shipped). Drop `params.answerOnlyBudget !== true` in
// prepare-think-gateway-call.ts: the bounded-budget assertion goes red. Drop
// the `takenAtActions !== actions` check: the "not again without a new tool
// call" case goes red.

import { afterEach, describe, expect, it } from "bun:test";
import { Effect, Layer } from "effect";
import { LLMService, TestLLMService, type CompletionRequest, type TestTurn } from "@reactive-agents/llm-provider";
import { EventBus, EventBusLive } from "@reactive-agents/core";
import {
  LEAN_FINAL_TURN_GUARD,
  LEAN_FINAL_TURN_HINT,
  shouldTakeLeanFinalTurn,
  namedInputsExtractable,
  unreadNamedInputs,
  unreadProseInputs,
  type LeanFinalTurnFacts,
} from "../../src/kernel/capabilities/reason/lean-final-turn.js";
import { resolveHarnessConfig, type HarnessConfig } from "../../src/harness-config.js";
import { executeReactive } from "../../src/strategies/reactive.js";
import { defaultReasoningConfig } from "../../src/types/config.js";
import { mockToolServiceLayer } from "../../src/testing/tool-service-mock.js";
import { buildRunEnvelope, provideTestEnvelope } from "../../src/kernel/envelope/run-envelope.js";

const TASK = "Use the gather tool to get the regional sales figures, then tell me which region grew fastest.";
const EVIDENCE = "north=+14%; south=+9%; west=+6%";
const ANSWER = "The north region grew fastest, at 14%, ahead of the south (9%) and the west (6%).";
const PARAMS = [{ name: "q", type: "string", required: true }];
const GATHER = { name: "gather", description: "Gather sales data.", parameters: PARAMS };

const BASE: LeanFinalTurnFacts = {
  enabled: true,
  nativeFC: true,
  planPosture: false,
  declaresToolWork: true,
  toolWorkSettled: true,
  inputsRead: true,
  actions: 1,
  takenAtActions: undefined,
};

describe("lean final turn: when a call is lean (pure)", () => {
  it("tool work declared and settled, none taken yet: lean", () => {
    expect(shouldTakeLeanFinalTurn(BASE)).toBe(true);
  });

  it("switch off, text-parse, plan posture: never", () => {
    expect(shouldTakeLeanFinalTurn({ ...BASE, enabled: false })).toBe(false);
    expect(shouldTakeLeanFinalTurn({ ...BASE, nativeFC: false })).toBe(false);
    expect(shouldTakeLeanFinalTurn({ ...BASE, planPosture: true })).toBe(false);
  });

  it("an answer-only contract, or tool work still open: not lean", () => {
    expect(shouldTakeLeanFinalTurn({ ...BASE, declaresToolWork: false })).toBe(false);
    expect(shouldTakeLeanFinalTurn({ ...BASE, toolWorkSettled: false })).toBe(false);
  });

  it("a named input still unread: not lean", () => {
    expect(shouldTakeLeanFinalTurn({ ...BASE, inputsRead: false })).toBe(false);
  });

  it("unreadNamedInputs: names the files no tool touched; write targets are not inputs", () => {
    const task = "Read a.json and b.json and add the counts.";
    const step = (type: string, content: string) => ({ type, content });
    expect(unreadNamedInputs(task, [])).toEqual(["a.json", "b.json"]);
    expect(unreadNamedInputs(task, [step("action", '{"path":"./a.json"}')])).toEqual(["b.json"]);
    expect(unreadNamedInputs(task, [step("action", "a.json"), step("observation", "b.json: 3")])).toEqual([]);
    expect(unreadNamedInputs("Write the summary to ./out.md.", [])).toEqual([]);
    // Prose-named inputs (zoo unread-input-prose): one read call per coordinated object.
    const act = (n: number) => Array.from({ length: n }, () => ({ type: "action" }));
    const prose = "Use the gather tool to read the first report and the second report, then add the two counts.";
    expect(unreadProseInputs(prose, act(0))).toBe(2);
    expect(unreadProseInputs(prose, act(1))).toBe(1);
    expect(unreadProseInputs(prose, act(2))).toBe(0);
    expect(unreadProseInputs("Read the report and summarize it.", act(0))).toBe(0);
  });

  it("unreadNamedInputs: absolute paths through dot-directories are extracted (zoo-live 2026-11-18)", () => {
    const dir = "/home/u/proj/.bench-run-123-abc";
    const task = `Read ${dir}/a.json and ${dir}/b.json and add the counts.`;
    expect(unreadNamedInputs(task, [])).toEqual([`${dir}/a.json`, `${dir}/b.json`]);
    expect(unreadNamedInputs(task, [{ type: "action", content: `{"path":"${dir}/a.json"}` }])).toEqual([`${dir}/b.json`]);
    expect(unreadNamedInputs("Read ~/.cfg/a.json and ./.env.local now.", [])).toEqual(["~/.cfg/a.json", ".env.local"]);
  });

  it("namedInputsExtractable: fails closed when a named file cannot be extracted", () => {
    expect(namedInputsExtractable("Read /home/u/.bench-run-1-ab/a.json and add it.")).toBe(true);
    expect(namedInputsExtractable("Summarize the report and tell me which region grew fastest.")).toBe(true);
    expect(namedInputsExtractable("Read /tmp/dir with spaces/x.json")).toBe(true);
    // A token the strict extractor cannot parse (non-word chars in a segment) must not read as "nothing unread".
    expect(namedInputsExtractable("Read /home/u/run@1/a.json and add it.")).toBe(false);
  });

  it("once per batch of tool work: not again until another tool call", () => {
    expect(shouldTakeLeanFinalTurn({ ...BASE, takenAtActions: 1 })).toBe(false);
    expect(shouldTakeLeanFinalTurn({ ...BASE, actions: 2, takenAtActions: 1 })).toBe(true);
  });
});

describe("lean final turn: resolution (opt-in)", () => {
  const saved = process.env.RA_LEAN_FINAL_TURN;
  afterEach(() => {
    if (saved === undefined) delete process.env.RA_LEAN_FINAL_TURN;
    else process.env.RA_LEAN_FINAL_TURN = saved;
  });

  it("off by default; on from config or RA_LEAN_FINAL_TURN=1; config false beats env", () => {
    delete process.env.RA_LEAN_FINAL_TURN;
    expect("leanFinalTurn" in resolveHarnessConfig()).toBe(false);
    expect(resolveHarnessConfig({ leanFinalTurn: true }).leanFinalTurn).toBe(true);
    process.env.RA_LEAN_FINAL_TURN = "1";
    expect(resolveHarnessConfig().leanFinalTurn).toBe(true);
    expect("leanFinalTurn" in resolveHarnessConfig({ leanFinalTurn: false })).toBe(false);
  });
});

/** Records every streamed request; plays `turns` in order. */
function scriptedModel(turns: readonly TestTurn[]) {
  const requests: CompletionRequest[] = [];
  const script = TestLLMService([...turns]);
  const layer = Layer.succeed(
    LLMService,
    LLMService.of({
      ...script,
      stream: (req) => {
        requests.push(req);
        return script.stream(req);
      },
    }),
  );
  return { layer, requests };
}

const BUDGET = {
  ...defaultReasoningConfig,
  strategies: {
    ...defaultReasoningConfig.strategies,
    reactive: { ...defaultReasoningConfig.strategies.reactive, maxIterations: 6, maxIterationsExplicit: true },
  },
};

async function run(
  harness: HarnessConfig,
  turns: readonly TestTurn[],
  opts: { readonly requiredTools?: readonly string[]; readonly task?: string } = {},
) {
  const model = scriptedModel(turns);
  const executed: unknown[] = [];
  const tools = mockToolServiceLayer({
    execute: (req) => Effect.sync(() => (executed.push((req as { arguments?: unknown }).arguments), { success: true, result: { finding: EVIDENCE } })),
    getTool: (name: string) => Effect.succeed({ name, description: "test", parameters: PARAMS }),
  });
  const fired: { outcome: string; metadata?: Record<string, unknown> }[] = [];
  const program = Effect.gen(function* () {
    const bus = yield* EventBus;
    yield* bus.subscribe((ev) =>
      ev._tag === "GuardFiredEmitted" && ev.guard === LEAN_FINAL_TURN_GUARD
        ? Effect.sync(() => { fired.push({ outcome: ev.outcome, metadata: ev.metadata }); })
        : Effect.void,
    );
    return yield* executeReactive({
      taskDescription: opts.task ?? TASK,
      taskType: "research",
      memoryContext: "",
      availableTools: ["gather"],
      availableToolSchemas: [GATHER],
      requiredTools: opts.requiredTools ?? ["gather"],
      config: BUDGET,
      // A thinking model: its think turns carry the thinking allowance.
      contextProfile: { tier: "mid", thinkingModel: true },
    } as never);
  });
  const result = await Effect.runPromise(
    provideTestEnvelope(
      program.pipe(Effect.provide(Layer.mergeAll(model.layer, tools, EventBusLive))),
      buildRunEnvelope({ harness }),
    ),
  );
  return { result, requests: model.requests, executed, fired };
}

const GATHER_THEN_ANSWER: readonly TestTurn[] = [
  { toolCall: { id: "g1", name: "gather", args: { q: "sales" } } },
  { text: ANSWER },
];

describe("end to end: the answer-only turn ships lean", () => {
  it("on: after the required call, the next request has no tools, thinking off, a bounded budget; one guard record", async () => {
    const { result, requests, fired } = await run({ leanFinalTurn: true }, GATHER_THEN_ANSWER);
    expect(requests.length).toBe(2);
    const [first, answer] = requests;
    expect(first!.tools?.length ?? 0).toBeGreaterThan(0);
    expect(answer!.tools ?? []).toHaveLength(0);
    expect(answer!.thinking).toBe(false);
    expect(typeof answer!.maxTokens).toBe("number");
    // The thinking allowance is gone: the lean budget is below the tool turn's.
    expect(answer!.maxTokens!).toBeLessThan(first!.maxTokens!);
    expect(JSON.stringify(answer!.messages)).toContain(LEAN_FINAL_TURN_HINT);
    expect(fired).toHaveLength(1);
    expect(fired[0]).toMatchObject({ outcome: "redirect", metadata: { tools: 0, thinking: false, actions: 1 } });
    expect(String(result.output ?? "")).toContain(ANSWER);
  }, 20000);

  it("off (default): the answer turn keeps its tools, thinking and budget (unchanged)", async () => {
    const { requests, fired } = await run({}, GATHER_THEN_ANSWER);
    expect(requests.length).toBe(2);
    const [first, answer] = requests;
    expect(answer!.tools?.length ?? 0).toBeGreaterThan(0);
    expect("thinking" in answer!).toBe(false);
    expect(answer!.maxTokens).toBe(first!.maxTokens);
    expect(fired).toHaveLength(0);
  }, 20000);

  it("on, but the contract declares no tool work: no lean turn", async () => {
    const { requests, fired } = await run({ leanFinalTurn: true }, GATHER_THEN_ANSWER, { requiredTools: [] });
    expect(requests.every((r) => (r.tools?.length ?? 0) > 0)).toBe(true);
    expect(fired).toHaveLength(0);
  }, 20000);

  const TWO_FILES = "Use the gather tool to read a.json and b.json, then add the two counts and tell me the total.";

  it("on: one of two named files read: the next turn keeps its tools (no lean turn)", async () => {
    // Exact-value shape: one call satisfies the contract's tool-coverage, b.json is unread.
    const { requests, fired } = await run({ leanFinalTurn: true }, [
      { toolCall: { id: "g1", name: "gather", args: { q: "a.json" } } },
      { text: "The count from a.json is 412. I still need the content of b.json." },
      { toolCall: { id: "g2", name: "gather", args: { q: "b.json" } } },
      { text: "The total is 412 plus 7, which is 419." },
    ], { task: TWO_FILES });
    expect(requests[1]!.tools?.length ?? 0).toBeGreaterThan(0); // b.json unread: no lean turn
    expect(fired).toHaveLength(0);
  }, 20000);

  it("on: dot-directory absolute paths, one of two read: the next turn keeps its tools (live shape)", async () => {
    const dir = "/home/u/proj/.bench-run-123-abc";
    const task = `Use the gather tool to read ${dir}/a.json and ${dir}/b.json, then add the two counts.`;
    const { requests, fired } = await run({ leanFinalTurn: true }, [
      { toolCall: { id: "g1", name: "gather", args: { q: `${dir}/a.json` } } },
      { text: "The count from a.json is 412. I still need to read b.json." },
      { toolCall: { id: "g2", name: "gather", args: { q: `${dir}/b.json` } } },
      { text: "The total is 419." },
    ], { task });
    expect(requests[1]!.tools?.length ?? 0).toBeGreaterThan(0);
    expect(fired).toHaveLength(0);
  }, 20000);

  it("on: both named files read: the lean turn still fires (happy path)", async () => {
    const { requests, fired, result } = await run({ leanFinalTurn: true }, [
      { toolCall: { id: "g1", name: "gather", args: { q: "a.json" } } },
      { toolCall: { id: "g2", name: "gather", args: { q: "b.json" } } },
      { text: "The total is 412 plus 7, which is 419." },
    ], { task: TWO_FILES });
    expect(fired).toHaveLength(1);
    expect(requests[requests.length - 1]!.tools ?? []).toHaveLength(0);
    expect(String(result.output ?? "")).toContain("419");
  }, 20000);

  it("on: a lean reply that is not the answer gets its tools back, and no second lean turn without a new tool call", async () => {
    // The lean turn's reply is a continuation, not an answer; the next call
    // must offer tools again.
    const { requests, fired } = await run({ leanFinalTurn: true }, [
      { toolCall: { id: "g1", name: "gather", args: { q: "sales" } } },
      { text: "Next I will check the east region." },
      { text: ANSWER },
    ]);
    expect(requests.length).toBeGreaterThanOrEqual(3);
    expect(requests[1]!.tools ?? []).toHaveLength(0);
    expect(requests[2]!.tools?.length ?? 0).toBeGreaterThan(0);
    expect(fired).toHaveLength(1);
  }, 20000);
});
