/**
 * S6 spike: shape 1, "partial answer with an unread named input" (the
 * leanFinalTurn exact-value defect), run through `executeReactive` against a
 * reactive policy model. `runArm` is shape-agnostic enough to become the real
 * `run-shape.ts`: it takes a task, a policy and a harness config.
 */
import { Effect, Layer } from "effect";
import { messageContentToString, type CompletionRequest } from "@reactive-agents/llm-provider";
import { EventBus, EventBusLive } from "@reactive-agents/core";
import {
  buildRunEnvelope,
  defaultReasoningConfig,
  executeReactive,
  provideTestEnvelope,
  type HarnessConfig,
} from "@reactive-agents/reasoning";
import { mockToolServiceLayer } from "@reactive-agents/reasoning/testing";
import { policyLLMLayer, requestTokens, type PolicyModel } from "../src/sim/policy-model.js";

export const A_RESULT = "A_COUNT=412";
export const B_RESULT = "B_COUNT=7";
const PARAMS = [{ name: "q", type: "string", required: true }];
const GATHER = { name: "gather", description: "Read one report.", parameters: PARAMS };

const BUDGET = {
  ...defaultReasoningConfig,
  strategies: {
    ...defaultReasoningConfig.strategies,
    reactive: { ...defaultReasoningConfig.strategies.reactive, maxIterations: 6, maxIterationsExplicit: true },
  },
};

export interface UnreadShape {
  readonly id: string;
  readonly task: string;
  /** Tool args that read the first / second input. */
  readonly firstArg: string;
  readonly secondArg: string;
}

/** Inputs named as files: the `unreadNamedInputs` gate sees them. */
export const NAMED: UnreadShape = {
  id: "unread-named",
  task: "Use the gather tool to read a.json and b.json, then add the two counts and tell me the total.",
  firstArg: "a.json",
  secondArg: "b.json",
};

/** Inputs named in prose only: the gate cannot see them. */
export const UNNAMED: UnreadShape = {
  id: "unread-unnamed",
  task: "Use the gather tool to read the first report and the second report, then add the two counts and tell me the total.",
  firstArg: "first report",
  secondArg: "second report",
};

/**
 * The model the defect needs: with tools it reads the second input; with NO tools
 * (a lean turn) it writes a partial reply instead of the total. Reactive: it reads
 * the request, not a cursor.
 */
export const partialWhenToolless = (shape: UnreadShape): PolicyModel => (req: CompletionRequest) => {
  const seen = req.messages.map((m) => messageContentToString(m.content)).join("\n");
  const hasA = seen.includes(A_RESULT);
  const hasB = seen.includes(B_RESULT);
  const hasTools = (req.tools?.length ?? 0) > 0;
  if (!hasA) return { toolCall: { id: "g1", name: "gather", args: { q: shape.firstArg } } };
  if (!hasB && hasTools) return { toolCall: { id: "g2", name: "gather", args: { q: shape.secondArg } } };
  if (!hasB) return { text: `The first count is 412. I still need the second report to give the total.` };
  return { text: "The total is 412 plus 7, which is 419." };
};

export interface ArmResult {
  readonly output: string;
  readonly solved: boolean;
  readonly agentTurns: number;
  readonly toollessAgentTurns: number;
  readonly executed: readonly string[];
  readonly guardFired: number;
  /** Sum of request-derived input tokens over all agent calls. */
  readonly agentInputTokens: number;
  /** Stable projection of the request log, for the determinism assertion. */
  readonly trace: string;
}

export async function runArm(
  shape: UnreadShape,
  harness: HarnessConfig,
  seed: number,
  guard: string,
): Promise<ArmResult> {
  const policy = policyLLMLayer(partialWhenToolless(shape), seed);
  const executed: string[] = [];
  const tools = mockToolServiceLayer({
    execute: (req) =>
      Effect.sync(() => {
        // The mock's request type says `args`; the runtime ToolInput carries `arguments`.
        const bag: unknown = "arguments" in req ? req.arguments : req.args;
        const q = typeof bag === "object" && bag !== null && "q" in bag ? String(bag.q) : "";
        executed.push(q);
        return { success: true, result: { finding: q === shape.firstArg ? A_RESULT : B_RESULT } };
      }),
    getTool: (name: string) => Effect.succeed({ name, description: "test", parameters: PARAMS }),
  });
  let fired = 0;
  const program = Effect.gen(function* () {
    const bus = yield* EventBus;
    yield* bus.subscribe((ev) =>
      ev._tag === "GuardFiredEmitted" && ev.guard === guard ? Effect.sync(() => void fired++) : Effect.void,
    );
    return yield* executeReactive({
      taskDescription: shape.task,
      taskType: "research",
      memoryContext: "",
      availableTools: ["gather"],
      availableToolSchemas: [GATHER],
      requiredTools: ["gather"],
      config: BUDGET,
      contextProfile: { tier: "mid", thinkingModel: true },
    } as never);
  });
  const result = await Effect.runPromise(
    provideTestEnvelope(
      program.pipe(Effect.provide(Layer.mergeAll(policy.layer, tools, EventBusLive))),
      buildRunEnvelope({ harness }),
    ),
  );
  const agent = policy.agentCalls();
  const output = String(result.output ?? "");
  return {
    output,
    solved: output.includes("419"),
    agentTurns: agent.length,
    toollessAgentTurns: agent.filter((c) => (c.req.tools?.length ?? 0) === 0).length,
    executed,
    guardFired: fired,
    agentInputTokens: agent.reduce((n, c) => n + c.inputTokens, 0),
    trace: JSON.stringify(
      policy.calls.map((c) => ({
        p: c.purpose,
        tools: (c.req.tools ?? []).map((t) => t.name),
        n: c.req.messages.length,
        tok: requestTokens(c.req),
      })),
    ),
  };
}
