// Run: bun test packages/reasoning/tests/kernel/capabilities/comprehend/judgment-classification.test.ts --timeout 15000
//
// Task 10 (shadow-only): judgmentComprehendShadow fires speculatively but
// must NEVER be awaited by the caller and NEVER alter the regex-derived
// TaskClassification/nominatedTools it shadows. Covers: agreeing answers,
// disagreeing answers, backend failure/timeout, JudgmentService entirely
// absent, call-count===1 for a small tool roster, and chunking above the
// per-ask cap.
import { describe, it, expect } from "bun:test";
import { Effect, Layer, Option } from "effect";
import { JudgmentService } from "@reactive-agents/judgment";
import type { JudgmentAnswers, JudgmentError } from "@reactive-agents/judgment";
import { classifyTask } from "../../../../src/kernel/capabilities/comprehend/task-classification.js";
import { judgmentComprehendShadow } from "../../../../src/kernel/capabilities/comprehend/judgment-classification.js";
import type { EventBusInstance } from "../../../../src/kernel/state/kernel-state.js";

type ShadowEvent = {
  readonly _tag: "JudgmentShadow";
  readonly site: string;
  readonly judged: string | null;
  readonly current: string;
  readonly agreement: boolean | null;
};

// "Explain the history of Paris." — no tool cues, no citation cues, no
// multi-step cues, short — trivial/short/needsMultiStep:false/needsCitation:false,
// format:null → "prose" (task-shape's fallback "explanation" form, task-intent's
// null format). Deterministic under the regex classifiers.
const TASK = "Explain the history of Paris.";

function makeMockEventBus(): { events: ShadowEvent[]; eb: Option.Option<EventBusInstance> } {
  const events: ShadowEvent[] = [];
  const eb: Option.Option<EventBusInstance> = Option.some({
    publish: (event: unknown) => {
      events.push(event as ShadowEvent);
      return Effect.void;
    },
  });
  return { events, eb };
}

let askCallCount = 0;

/** Every base+tool question answered with the SAME probability/value — used to construct agree/disagree fixtures per test. */
function fakeJudgmentLayer(build: (questionIds: readonly string[]) => Record<string, unknown>) {
  askCallCount = 0;
  return Layer.succeed(JudgmentService, {
    ask: (input) => {
      askCallCount++;
      const answers = build(Object.keys(input.questions));
      return Effect.succeed(answers as unknown as JudgmentAnswers<typeof input.questions>);
    },
  } satisfies JudgmentService["Type"]);
}

function fakeJudgmentFailing() {
  askCallCount = 0;
  return Layer.succeed(JudgmentService, {
    ask: () => {
      askCallCount++;
      return Effect.fail({ _tag: "JudgmentTimeout", message: "shadow probe timed out", timeoutMs: 1 } as unknown as JudgmentError);
    },
  } satisfies JudgmentService["Type"]);
}

/** Builds an answer object matching every question id to a Score(0)/Noul(false)/Choice("prose") answer — i.e. agrees with TASK's regex verdict. */
function agreeingAnswers(questionIds: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const id of questionIds) {
    if (id === "complexity") {
      out[id] = { kind: "score", value: 0, probabilities: {}, confidence: 0.9, calibrated: true };
    } else if (id === "output-format") {
      out[id] = { kind: "choice", value: "prose", probabilities: {}, confidence: 0.9, calibrated: true };
    } else {
      out[id] = { kind: "noul", probability: 0.1 }; // false — agrees with TASK's all-false shape signals
    }
  }
  return out;
}

/** Every question answered opposite of TASK's regex verdict. */
function disagreeingAnswers(questionIds: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const id of questionIds) {
    if (id === "complexity") {
      out[id] = { kind: "score", value: 2, probabilities: {}, confidence: 0.9, calibrated: true }; // complex, not trivial
    } else if (id === "output-format") {
      out[id] = { kind: "choice", value: "json", probabilities: {}, confidence: 0.9, calibrated: true };
    } else {
      out[id] = { kind: "noul", probability: 0.9 }; // true — disagrees
    }
  }
  return out;
}

const runShadow = async (
  judgmentLayer: Layer.Layer<JudgmentService> | undefined,
  availableToolNames: readonly string[] = [],
) => {
  const { events, eb } = makeMockEventBus();
  const classification = classifyTask(TASK);
  const effect = judgmentComprehendShadow(
    () => ({
      task: TASK,
      classification,
      nominatedToolNames: new Set<string>(),
      availableToolNames,
    }),
    eb,
  );
  await Effect.runPromise(
    Effect.gen(function* () {
      yield* effect;
      // Cooperatively yield so the forkDaemon shadow fiber (fake backend is
      // synchronous) settles before we read `events`.
      yield* Effect.sleep("50 millis");
    }).pipe(Effect.provide(judgmentLayer ?? Layer.empty)),
  );
  return events;
};

describe("judgmentComprehendShadow (Task 10, shadow-only)", () => {
  it("agreeing answers: every sub-question reports agreement:true", async () => {
    const events = await runShadow(fakeJudgmentLayer(agreeingAnswers));

    expect(events.length).toBe(5); // 5 base questions, no tools
    expect(askCallCount).toBe(1);
    for (const e of events) {
      expect(e.site).toBe("task-comprehension");
      expect(e.judged).not.toBeNull();
      expect(e.agreement).toBe(true);
    }
  }, 15000);

  it("disagreeing answers: every sub-question reports agreement:false", async () => {
    const events = await runShadow(fakeJudgmentLayer(disagreeingAnswers));

    expect(events.length).toBe(5);
    for (const e of events) {
      expect(e.agreement).toBe(false);
    }
  }, 15000);

  it("backend failure/timeout: every sub-question reports judged:null, agreement:null", async () => {
    const events = await runShadow(fakeJudgmentFailing());

    expect(events.length).toBe(5);
    for (const e of events) {
      expect(e.judged).toBeNull();
      expect(e.agreement).toBeNull();
    }
  }, 15000);

  it("JudgmentService entirely absent: no crash, no shadow events", async () => {
    const events = await runShadow(undefined);
    expect(events.length).toBe(0);
  }, 15000);

  it("JudgmentService absent: the input thunk (classifyTask re-run + tool-roster Set/.map) is never invoked — real zero-cost, not just zero-events", async () => {
    const { eb } = makeMockEventBus();
    let buildInputCalls = 0;
    const effect = judgmentComprehendShadow(() => {
      buildInputCalls++;
      return {
        task: TASK,
        classification: classifyTask(TASK),
        nominatedToolNames: new Set<string>(),
        availableToolNames: [],
      };
    }, eb);

    await Effect.runPromise(
      Effect.gen(function* () {
        yield* effect;
        yield* Effect.sleep("50 millis");
      }).pipe(Effect.provide(Layer.empty)),
    );

    expect(buildInputCalls).toBe(0);
  }, 15000);

  it("small tool roster (3 tools, 8 total questions): single ask() call", async () => {
    const events = await runShadow(fakeJudgmentLayer(agreeingAnswers), ["tool-a", "tool-b", "tool-c"]);

    expect(askCallCount).toBe(1);
    expect(events.length).toBe(8); // 5 base + 3 tool nouls
  }, 15000);

  it("large tool roster (40 tools, 45 total questions) above CHUNK_CAP=30: chunks into 2 ask() calls", async () => {
    const tools = Array.from({ length: 40 }, (_, i) => `tool-${i}`);
    const events = await runShadow(fakeJudgmentLayer(agreeingAnswers), tools);

    // chunk 0: 5 base + 25 tools = 30; chunk 1: remaining 15 tools = 2 calls total.
    expect(askCallCount).toBe(2);
    expect(events.length).toBe(45); // 5 base + 40 tool nouls, across both chunks
  }, 15000);
});
