// Run: bun test packages/reasoning/tests/kernel/capabilities/verify/completion-judgment-shadow.test.ts --timeout 15000
//
// Task 2 (Phase D leverage plan, shadow-only): the completion-judgment Noul
// fires speculatively inside `verifyAndEmit` (the single funnel every
// terminal-verification call site — runner.ts x2, stall-deliverable.ts —
// already goes through) but must NEVER alter `VerificationResult.verified`,
// the Verifier's checks, or which downstream branch (terminate.ts /
// arbitrator.ts) the run takes. Covers: agreeing answer, disagreeing answer,
// backend failure/timeout, JudgmentService entirely absent, and a
// non-terminal verification (shadow must not fire at all).
import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { EventBus, EventBusLive } from "@reactive-agents/core";
import type { AgentEvent } from "@reactive-agents/core";
import { JudgmentService } from "@reactive-agents/judgment";
import type { JudgmentAnswers, JudgmentError } from "@reactive-agents/judgment";
import { defaultVerifier, verifyAndEmit, type VerificationContext } from "../../../../src/kernel/capabilities/verify/verifier.js";
import { makeStep } from "../../../../src/kernel/capabilities/sense/step-utils.js";

type ShadowEvent = Extract<AgentEvent, { _tag: "JudgmentShadow" }>;

const baseTerminalContext: VerificationContext = {
  action: "final-answer",
  content: "The capital of France is Paris.",
  actionSuccess: true,
  task: "What is the capital of France?",
  priorSteps: [makeStep("observation", "search result: Paris is the capital of France.")],
  terminal: true,
};

const fakeJudgmentAnswering = (probability: number) =>
  Layer.succeed(JudgmentService, {
    ask: (input) =>
      Effect.succeed({
        "completion-satisfied": { kind: "noul", probability },
      } as unknown as JudgmentAnswers<typeof input.questions>),
  } satisfies JudgmentService["Type"]);

const fakeJudgmentFailing = () =>
  Layer.succeed(JudgmentService, {
    ask: () =>
      Effect.fail({ _tag: "JudgmentTimeout", message: "shadow probe timed out", timeoutMs: 1 } as unknown as JudgmentError),
  } satisfies JudgmentService["Type"]);

/** Runs verifyAndEmit against `context`, capturing any completion-satisfied JudgmentShadow event. */
const runWithShadowCapture = async (
  context: VerificationContext,
  judgmentLayer?: Layer.Layer<JudgmentService>,
) => {
  const captured: ShadowEvent[] = [];
  const baseLayer = judgmentLayer ? Layer.merge(EventBusLive, judgmentLayer) : EventBusLive;

  const verdict = await Effect.runPromise(
    Effect.gen(function* () {
      const eb = yield* EventBus;
      yield* eb.on("JudgmentShadow", (event) =>
        Effect.sync(() => {
          if (event.site === "completion-satisfied") captured.push(event);
        }),
      );

      const result = yield* verifyAndEmit({
        verifier: defaultVerifier,
        context,
        taskId: "t1",
        iteration: 0,
      });

      // Cooperatively yield so the forkDaemon shadow fiber (fake backend is
      // synchronous) settles before this Effect completes and the fake
      // EventBus subscription goes out of scope.
      yield* Effect.sleep("50 millis");

      return result;
    }).pipe(Effect.provide(baseLayer)),
  );

  return { verdict, captured };
};

describe("completion-judgment shadow (Task 2, shadow-only)", () => {
  it("agreeing judgment answer: shadow reports agreement:true, verdict.verified unchanged", async () => {
    const { verdict, captured } = await runWithShadowCapture(baseTerminalContext, fakeJudgmentAnswering(0.9));

    expect(verdict.verified).toBe(true); // defaultVerifier's own heuristic verdict
    expect(captured).toHaveLength(1);
    expect(captured[0]?.site).toBe("completion-satisfied");
    expect(captured[0]?.judged).toBe("true");
    expect(captured[0]?.current).toBe("true");
    expect(captured[0]?.agreement).toBe(true);
  }, 15000);

  it("disagreeing judgment answer: shadow reports agreement:false, verdict.verified STILL unchanged", async () => {
    const { verdict, captured } = await runWithShadowCapture(baseTerminalContext, fakeJudgmentAnswering(0.1));

    expect(verdict.verified).toBe(true); // heuristic's own verdict, untouched by the disagreeing shadow
    expect(captured).toHaveLength(1);
    expect(captured[0]?.judged).toBe("false");
    expect(captured[0]?.current).toBe("true");
    expect(captured[0]?.agreement).toBe(false);
  }, 15000);

  it("judgment backend failure/timeout: shadow reports judged:null, agreement:null, verdict untouched", async () => {
    const { verdict, captured } = await runWithShadowCapture(baseTerminalContext, fakeJudgmentFailing());

    expect(verdict.verified).toBe(true);
    expect(captured).toHaveLength(1);
    expect(captured[0]?.judged).toBeNull();
    expect(captured[0]?.agreement).toBeNull();
  }, 15000);

  it("JudgmentService entirely absent (no .withJudgment()): no crash, no shadow event, verdict untouched", async () => {
    const { verdict, captured } = await runWithShadowCapture(baseTerminalContext, undefined);

    expect(verdict.verified).toBe(true);
    expect(captured).toHaveLength(0);
  }, 15000);

  it("non-terminal verification: shadow never fires even when JudgmentService is wired", async () => {
    const nonTerminalContext: VerificationContext = { ...baseTerminalContext, terminal: false };
    const { verdict, captured } = await runWithShadowCapture(nonTerminalContext, fakeJudgmentAnswering(0.9));

    expect(verdict.action).toBe(nonTerminalContext.action);
    expect(captured).toHaveLength(0);
  }, 15000);

  it("final review #1/#2: over-budget compressed observation content never leaks recall()/STORED claims or an unbounded size into the shadow prompt", async () => {
    // Mirrors compressToolResult's real over-budget shape
    // (tool-formatting.ts): a "[STORED: <key> | <tool>]" header plus a
    // trailing "recall(\"<key>\", ...)" instruction — only a real capability
    // for the agent's OWN reasoning loop (scratchpad + recall tool), never
    // true for the judgment backend this shadow calls.
    const overBudgetObservation =
      `[STORED: _tool_result_x | web-search]\n` +
      `Type: Object(3 keys)\n` +
      `  price: 70836.96\n` +
      `  volume: ${"9".repeat(2000)}\n` +
      `  — full object is stored. Use recall("_tool_result_x", start: 0, maxChars: 1200), ` +
      `recall("_tool_result_x", query: "keyword"), or | transform: for focused extraction.`;

    const captured: { state: unknown }[] = [];
    const capturingJudgment = Layer.succeed(JudgmentService, {
      ask: (input) => {
        captured.push({ state: input.state });
        return Effect.succeed({
          "completion-satisfied": { kind: "noul", probability: 0.9 },
        } as unknown as JudgmentAnswers<typeof input.questions>);
      },
    } satisfies JudgmentService["Type"]);

    const context: VerificationContext = {
      ...baseTerminalContext,
      priorSteps: [makeStep("observation", overBudgetObservation)],
    };

    await runWithShadowCapture(context, capturingJudgment);

    expect(captured).toHaveLength(1);
    const entry = captured[0]?.state as { recentObservations?: readonly string[] };
    expect(entry.recentObservations).toHaveLength(1);
    const sanitized = entry.recentObservations?.[0] ?? "";
    expect(sanitized).not.toContain("recall(");
    expect(sanitized).not.toContain("STORED");
    // Bounded per-item size, not just item count — the raw observation above
    // is well over 2000 chars.
    expect(sanitized.length).toBeLessThan(1000);
  }, 15000);

  it("disagreeing shadow on a REJECTED heuristic verdict: agreement:false, verdict.verified stays false", async () => {
    // Force the heuristic to reject: empty content fails non-empty-content.
    const rejectingContext: VerificationContext = { ...baseTerminalContext, content: "" };
    const { verdict, captured } = await runWithShadowCapture(rejectingContext, fakeJudgmentAnswering(0.95));

    expect(verdict.verified).toBe(false); // heuristic's own rejection, untouched
    expect(captured).toHaveLength(1);
    expect(captured[0]?.current).toBe("false");
    expect(captured[0]?.judged).toBe("true");
    expect(captured[0]?.agreement).toBe(false);
  }, 15000);
});
