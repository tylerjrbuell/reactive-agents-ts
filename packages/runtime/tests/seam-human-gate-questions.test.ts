// Run: bun test packages/runtime/tests/seam-human-gate-questions.test.ts --timeout 20000
//
// Seam pin: structured `request_user_input` questions travel through the live
// gate. Direct-import of engine/human-gate.ts, no agent build.
//
//   Q1 a structured ask reaches the gate request, listeners, the stream event
//      (InteractionRequested.questions) and pending(); the id-keyed answer comes back.
//   Q2 a legacy kind+schema ask carries NO `questions` anywhere.
//   Q3 a gate timeout reaches the kernel as { answered:false, timedOut:true }.
//   Q4 questionsOfSchema reads a durable pause's persisted { questions } schema.
//
// Red-on-cut: drop `questions` from liveAskUser's gate request -> Q1 red; drop
// `timedOut` from the abandoned mapping -> Q3 red.
import { describe, it, expect } from "bun:test";
import { Effect, Fiber } from "effect";
import { rootContext } from "@reactive-agents/core";
import type { InteractionQuestion } from "@reactive-agents/core";
import { withRunScope } from "@reactive-agents/core/internal/run-scope";
import type { AskUserRequest } from "@reactive-agents/reasoning";
import {
  HumanGate,
  humanGateLayer,
  liveAskUser,
  makeHumanGate,
  questionsOfSchema,
  watchLiveGate,
} from "../src/engine/human-gate.js";
import type { AgentStreamEvent } from "../src/stream-types.js";

const QUESTIONS: readonly InteractionQuestion[] = [
  { id: "env", prompt: "Which env?", type: "single-choice", options: [{ label: "Prod", value: "prod" }] },
  { id: "ok", prompt: "Proceed?", type: "boolean" },
];

const structuredRequest = (): AskUserRequest => ({
  interactionId: "i-1",
  kind: "form",
  prompt: "",
  schema: {},
  // The kernel's Question type is structurally the core InteractionQuestion.
  questions: QUESTIONS as AskUserRequest["questions"],
  structured: true,
});

const legacyRequest = (): AskUserRequest => ({
  interactionId: "i-2",
  kind: "confirmation",
  prompt: "Sure?",
  schema: {},
  questions: [{ id: "answer", prompt: "Sure?", type: "boolean" }],
  structured: false,
});

const inRun = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(withRunScope(rootContext("run-q", "agent-q")));

describe("human gate structured questions seam", () => {
  it("Q1 structured ask: gate request, stream event and pending() carry questions; answer flows back", async () => {
    const gate = makeHumanGate();
    const events: AgentStreamEvent[] = [];
    const program = inRun(
      Effect.gen(function* () {
        yield* watchLiveGate("run-q", "agent-q", (e) => Effect.sync(() => void events.push(e)));
        const fiber = yield* Effect.fork(liveAskUser()(structuredRequest()));
        yield* Effect.sleep(10);
        const pending = yield* gate.pending();
        const answer = { env: "prod", ok: true };
        yield* gate.answer("run-q", { kind: "interaction", interactionId: "i-1", value: answer });
        const outcome = yield* Fiber.join(fiber);
        return { pending, outcome, answer };
      }),
    ).pipe(Effect.provideService(HumanGate, gate));
    const { pending, outcome, answer } = await Effect.runPromise(program);

    expect(pending[0]?.kind === "interaction" && pending[0].questions).toEqual(QUESTIONS);
    const requested = events.find((e) => e._tag === "InteractionRequested");
    expect(requested?._tag === "InteractionRequested" && requested.questions).toEqual(QUESTIONS);
    expect(outcome).toEqual({ answered: true, value: answer });
  });

  it("Q2 legacy ask carries no questions on the request or the stream event", async () => {
    const gate = makeHumanGate();
    const events: AgentStreamEvent[] = [];
    const program = inRun(
      Effect.gen(function* () {
        yield* watchLiveGate("run-q", "agent-q", (e) => Effect.sync(() => void events.push(e)));
        const fiber = yield* Effect.fork(liveAskUser()(legacyRequest()));
        yield* Effect.sleep(10);
        const pending = yield* gate.pending();
        yield* gate.answer("run-q", { kind: "interaction", interactionId: "i-2", value: true });
        yield* Fiber.join(fiber);
        return pending;
      }),
    ).pipe(Effect.provideService(HumanGate, gate));
    const pending = await Effect.runPromise(program);

    expect(pending[0] !== undefined && "questions" in pending[0]).toBe(false);
    const requested = events.find((e) => e._tag === "InteractionRequested");
    expect(requested !== undefined && "questions" in requested).toBe(false);
  });

  it("Q3 a gate timeout is reported as timedOut to the kernel", async () => {
    const outcome = await Effect.runPromise(
      inRun(liveAskUser()(structuredRequest())).pipe(Effect.provide(humanGateLayer({ interactionTimeoutMs: 20 }))),
    );
    expect(outcome.answered).toBe(false);
    expect(!outcome.answered && outcome.timedOut).toBe(true);
  });

  it("Q4 questionsOfSchema reads a persisted structured schema, not a legacy one", () => {
    expect(questionsOfSchema({ questions: QUESTIONS })).toEqual(QUESTIONS);
    expect(questionsOfSchema({ options: ["a"] })).toBeUndefined();
    expect(questionsOfSchema("junk")).toBeUndefined();
  });
});
