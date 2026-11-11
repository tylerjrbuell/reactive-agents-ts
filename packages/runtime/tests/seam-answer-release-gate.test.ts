// Run: bun test packages/runtime/tests/seam-answer-release-gate.test.ts --timeout 30000
//
// Answer release gate (2026-11-11): an answer the output guardrail blocks is
// never published. Cortex live QA (487399ff0) saw a PII-blocked answer go out
// as `FinalAnswerProduced` before the output screen ran: the kernel publishes
// the event when its loop ends, and the screen runs later. Any event consumer
// received the blocked text.
//
// Pins:
//   G1 run(): no FinalAnswerProduced (and no other event) carries the blocked
//      answer; the run fails with the output-guardrail error, not the text.
//   G2 runStream(): no TextDelta / StreamCompleted carries it; the stream ends
//      StreamError.
//   G3 a clean answer is still published once as FinalAnswerProduced, and its
//      stream deltas still arrive (held until the run ends, then delivered).
//   G4 the held bus holds only its own run's answers and forwards the rest.
//
// Red-on-cut:
//   - drop `holdUnscreenedAnswers` in execution-engine.ts -> G1 sees the SSN on
//     FinalAnswerProduced.
//   - drop `releaseScreenedAnswers` in execute-output-screens.ts -> G3 sees no
//     FinalAnswerProduced.
//   - give execute-stream.ts the raw delta sink again -> G2 sees the SSN on a TextDelta.
import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { EventBus, EventBusLive, type AgentEvent } from "@reactive-agents/core";
import { ReactiveAgents } from "../src/builder.js";
import type { AgentStreamEvent } from "../src/stream-types.js";
import { makeHeldAnswerBus } from "../src/engine/answer-release-gate.js";

const SSN = "123-45-6789";

function makeAgent(answer: string) {
  return ReactiveAgents.create()
    .withName("answer-gate")
    .withProvider("test")
    .withTestScenario([{ text: answer }])
    .withReasoning({ defaultStrategy: "reactive", enableStrategySwitching: false })
    .withGuardrails({ pii: true, injection: false, toxicity: false })
    .withMaxIterations(3)
    .build();
}

const carries = (value: unknown, text: string): boolean => JSON.stringify(value ?? null).includes(text);

describe("answer release gate: a blocked answer is never published", () => {
  it("G1 run(): no event carries the blocked answer; the run fails on the output screen", async () => {
    const agent = await makeAgent(`The customer's SSN is ${SSN}.`);
    const events: AgentEvent[] = [];
    const unsub = await agent.subscribe((e) => {
      events.push(e);
    });
    let error: unknown;
    let result: unknown;
    try {
      result = await agent.run("What is the customer's SSN?");
    } catch (e) {
      error = e;
    } finally {
      unsub();
      await agent.dispose();
    }
    expect(events.some((e) => e._tag === "GuardrailViolationDetected" && e.blocked)).toBe(true);
    const answers = events.filter((e) => e._tag === "FinalAnswerProduced");
    expect(answers.filter((e) => carries(e, SSN))).toEqual([]);
    expect(carries(result, SSN)).toBe(false);
    expect(String((error as { message?: unknown } | undefined)?.message ?? "")).toContain("Output guardrail");
    expect(String((error as { message?: unknown } | undefined)?.message ?? "")).not.toContain(SSN);
  }, 30_000);

  it("G2 runStream(): no delta or terminal event carries the blocked answer", async () => {
    const agent = await makeAgent(`The customer's SSN is ${SSN}.`);
    const events: AgentStreamEvent[] = [];
    try {
      for await (const e of agent.runStream("What is the customer's SSN?")) events.push(e);
    } finally {
      await agent.dispose();
    }
    expect(events.at(-1)?._tag).toBe("StreamError");
    expect(events.filter((e) => e._tag === "TextDelta" && carries(e, SSN))).toEqual([]);
    expect(events.filter((e) => (e._tag === "StreamCompleted" || e._tag === "StreamError") && carries(e, SSN))).toEqual([]);
  }, 30_000);

  it("G3 a clean answer is published once and its stream deltas arrive", async () => {
    const agent = await makeAgent("Paris is the capital of France.");
    const events: AgentEvent[] = [];
    const unsub = await agent.subscribe((e) => {
      events.push(e);
    });
    const streamed: AgentStreamEvent[] = [];
    try {
      const result = await agent.run("What is the capital of France?");
      expect(result.success).toBe(true);
      const answers = events.filter((e) => e._tag === "FinalAnswerProduced");
      expect(answers.length).toBeGreaterThan(0);
      expect(answers.some((e) => e._tag === "FinalAnswerProduced" && e.answer.includes("Paris"))).toBe(true);
      // The answer comes out after the screen, never after the run ended.
      const answerAt = events.findIndex((e) => e._tag === "FinalAnswerProduced");
      const completedAt = events.findIndex((e) => e._tag === "AgentCompleted");
      expect(answerAt).toBeLessThan(completedAt);
      for await (const e of agent.runStream("What is the capital of France?")) streamed.push(e);
    } finally {
      unsub();
      await agent.dispose();
    }
    expect(streamed.at(-1)?._tag).toBe("StreamCompleted");
    const text = streamed.flatMap((e) => (e._tag === "TextDelta" ? [e.text] : [])).join("");
    expect(text).toContain("Paris");
    const deltaAt = streamed.findIndex((e) => e._tag === "TextDelta");
    expect(deltaAt).toBeLessThan(streamed.length - 1);
  }, 30_000);

  it("G4 the held bus holds only its own run's answers and forwards everything else", async () => {
    const seen = await Effect.runPromise(
      Effect.gen(function* () {
        const bus = yield* EventBus;
        const got: AgentEvent[] = [];
        yield* bus.subscribe((e) => Effect.sync(() => void got.push(e)));
        const gate = makeHeldAnswerBus(bus, "run-1");
        const answer = (taskId: string): AgentEvent => ({
          _tag: "FinalAnswerProduced",
          taskId,
          strategy: "reactive",
          answer: `answer of ${taskId}`,
          iteration: 1,
          totalTokens: 0,
        });
        yield* gate.bus.publish(answer("run-1"));
        yield* gate.bus.publish(answer("child-run"));
        yield* gate.bus.publish({ _tag: "TaskCreated", taskId: "run-1" } as AgentEvent);
        const beforeRelease = got.map((e) => `${e._tag}:${(e as { taskId?: string }).taskId}`);
        yield* gate.release;
        yield* gate.bus.publish(answer("run-1"));
        return { beforeRelease, after: got.map((e) => `${e._tag}:${(e as { taskId?: string }).taskId}`) };
      }).pipe(Effect.provide(EventBusLive as Layer.Layer<EventBus>)),
    );
    expect(seen.beforeRelease).toEqual(["FinalAnswerProduced:child-run", "TaskCreated:run-1"]);
    expect(seen.after).toEqual([
      "FinalAnswerProduced:child-run",
      "TaskCreated:run-1",
      "FinalAnswerProduced:run-1",
      "FinalAnswerProduced:run-1",
    ]);
  });
});
