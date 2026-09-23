// Run: bun test packages/runtime/tests/judgment-rank.test.ts --timeout 15000
//
// `agent.judgeRank()` — Task 6 of
// wiki/Planning/Implementation-Plans/2026-09-23-judgment-primitive-phase-d-leverage.md.
//
// Pins:
//   (a) RANKING — N candidates scored via a single Score question come back
//       sorted best-first, each with its score attached.
//   (b) SINGLE-CHUNK BATCHING — a candidate count at/under `chunkCap` fires
//       exactly ONE `ask()` call, batching every candidate's question together.
//   (c) MULTI-CHUNK BATCHING — a candidate count over `chunkCap` fires
//       `ceil(candidates / chunkCap)` `ask()` calls, never one per candidate.
//   (d) DETERMINISTIC TIES — equal scores keep the candidates' original
//       relative (input) order, not answer/object-key order.
//   (e) ABSENCE — `agent.judgeRank()` without `.withJudgment()` rejects with
//       a clear error, same precedent as `agent.judge()`/`agent.listModels()`.

import { describe, it, expect, afterEach } from "bun:test";
import { Effect } from "effect";
import type { JudgmentAnswers, JudgmentError, JudgmentService, ScoreAnswer } from "@reactive-agents/judgment";
import { judgeRank, type JudgeRankCandidate, type JudgeRankQuestion } from "../src/judgment-rank.js";
import { ReactiveAgents } from "../src/index.js";

const question: JudgeRankQuestion = {
  instructions: "How relevant is this candidate?",
  criteria: ["poor", "adequate", "excellent"],
};

const scoreAnswer = (value: number, confidence = 0.9): ScoreAnswer => ({
  kind: "score",
  value,
  probabilities: {},
  confidence,
  calibrated: false,
});

/**
 * A mock `JudgmentService["Type"]` whose `ask()` answers every question id
 * in the batch from a caller-supplied `{id: score}` map (defaulting unknown
 * ids to 0), and records every call's question-id set for the batching
 * assertions ((b)/(c)) — cheaper and more direct than routing through the
 * real `llm` backend's `completeStructured()` schema-decoding path, which
 * `builder-judgment.test.ts` already covers for `agent.judge()`.
 */
function makeMockJudgment(
  scoresById: Readonly<Record<string, number>>,
  calls: { count: number; questionIdsPerCall: string[][] },
): JudgmentService["Type"] {
  return {
    ask: (input) => {
      calls.count += 1;
      const questionIds = Object.keys(input.questions);
      calls.questionIdsPerCall.push(questionIds);
      const answers: Record<string, ScoreAnswer> = {};
      for (const id of questionIds) {
        answers[id] = scoreAnswer(scoresById[id] ?? 0);
      }
      return Effect.succeed(answers as JudgmentAnswers<typeof input.questions>);
    },
    listModels: () => Effect.die(new Error("unused in this test")),
  };
}

const candidates = (n: number): readonly JudgeRankCandidate[] =>
  Array.from({ length: n }, (_, i) => ({ id: `c${i}`, state: { text: `candidate ${i}` } }));

describe("judgeRank() — Task 6 core primitive", () => {
  it("(a) RANKING: sorts candidates best-first with each candidate's score attached", async () => {
    const calls = { count: 0, questionIdsPerCall: [] as string[][] };
    const judgment = makeMockJudgment({ c0: 0.2, c1: 0.9, c2: 0.5 }, calls);

    const result = await Effect.runPromise(
      judgeRank(judgment, candidates(3), question) as Effect.Effect<
        ReadonlyArray<{ id: string; score: number; confidence: number }>,
        JudgmentError
      >
    );

    expect(result.map((r) => r.id)).toEqual(["c1", "c2", "c0"]);
    expect(result[0]!.score).toBeCloseTo(0.9);
    expect(result[1]!.score).toBeCloseTo(0.5);
    expect(result[2]!.score).toBeCloseTo(0.2);
    expect(result.every((r) => r.confidence === 0.9)).toBe(true);
  });

  it("(b) SINGLE-CHUNK BATCHING: candidate count at/under chunkCap fires exactly one ask() call", async () => {
    const calls = { count: 0, questionIdsPerCall: [] as string[][] };
    const judgment = makeMockJudgment({}, calls);

    await Effect.runPromise(
      judgeRank(judgment, candidates(5), question, { chunkCap: 30 }) as Effect.Effect<
        ReadonlyArray<{ id: string; score: number; confidence: number }>,
        JudgmentError
      >
    );

    expect(calls.count).toBe(1);
    expect(calls.questionIdsPerCall[0]).toHaveLength(5);
  });

  it("(c) MULTI-CHUNK BATCHING: candidate count over chunkCap fires ceil(n/chunkCap) ask() calls", async () => {
    const calls = { count: 0, questionIdsPerCall: [] as string[][] };
    const judgment = makeMockJudgment({}, calls);

    // 7 candidates, chunkCap 3 -> ceil(7/3) = 3 calls: [3, 3, 1].
    await Effect.runPromise(
      judgeRank(judgment, candidates(7), question, { chunkCap: 3 }) as Effect.Effect<
        ReadonlyArray<{ id: string; score: number; confidence: number }>,
        JudgmentError
      >
    );

    expect(calls.count).toBe(3);
    expect(calls.questionIdsPerCall.map((ids) => ids.length)).toEqual([3, 3, 1]);
    // Never one ask() call per candidate.
    expect(calls.count).toBeLessThan(candidates(7).length);
  });

  it("(f) chunkCap <= 0 rejects instead of hanging in an infinite loop", async () => {
    const calls = { count: 0, questionIdsPerCall: [] as string[][] };
    const judgment = makeMockJudgment({}, calls);

    await expect(
      Effect.runPromise(
        judgeRank(judgment, candidates(3), question, { chunkCap: 0 }) as Effect.Effect<
          ReadonlyArray<{ id: string; score: number; confidence: number }>,
          JudgmentError
        >
      )
    ).rejects.toThrow(/chunkCap must be a positive finite number/);

    await expect(
      Effect.runPromise(
        judgeRank(judgment, candidates(3), question, { chunkCap: -5 }) as Effect.Effect<
          ReadonlyArray<{ id: string; score: number; confidence: number }>,
          JudgmentError
        >
      )
    ).rejects.toThrow(/chunkCap must be a positive finite number/);

    // Never called ask() — the guard fires before any chunk is built.
    expect(calls.count).toBe(0);
  });

  it("(g) DUPLICATE IDS: rejects up front instead of silently overwriting a candidate", async () => {
    const calls = { count: 0, questionIdsPerCall: [] as string[][] };
    const judgment = makeMockJudgment({}, calls);
    const dupes: readonly JudgeRankCandidate[] = [
      { id: "c0", state: { text: "first" } },
      { id: "c0", state: { text: "second" } },
    ];

    await expect(
      Effect.runPromise(
        judgeRank(judgment, dupes, question) as Effect.Effect<
          ReadonlyArray<{ id: string; score: number; confidence: number }>,
          JudgmentError
        >
      )
    ).rejects.toThrow(/duplicate candidate id "c0"/);

    expect(calls.count).toBe(0);
  });

  it("(h) __proto__ CANDIDATE ID: a candidate id of exactly \"__proto__\" is judged, not dropped", async () => {
    const calls = { count: 0, questionIdsPerCall: [] as string[][] };
    const judgment = makeMockJudgment({ ["__proto__"]: 0.7 }, calls);

    const result = await Effect.runPromise(
      judgeRank(judgment, [{ id: "__proto__", state: { text: "candidate" } }], question) as Effect.Effect<
        ReadonlyArray<{ id: string; score: number; confidence: number }>,
        JudgmentError
      >
    );

    expect(result.map((r) => r.id)).toEqual(["__proto__"]);
    expect(calls.questionIdsPerCall[0]).toEqual(["__proto__"]);
  });

  it("(d) DETERMINISTIC TIES: equal scores keep the candidates' original relative order", async () => {
    const calls = { count: 0, questionIdsPerCall: [] as string[][] };
    // c0 and c2 tie at 0.5; c1 is highest. Input order is c0, c1, c2.
    const judgment = makeMockJudgment({ c0: 0.5, c1: 0.9, c2: 0.5 }, calls);

    const result = await Effect.runPromise(
      judgeRank(judgment, candidates(3), question) as Effect.Effect<
        ReadonlyArray<{ id: string; score: number; confidence: number }>,
        JudgmentError
      >
    );

    // c1 wins outright; among the 0.5 tie, c0 (earlier in input) stays before c2.
    expect(result.map((r) => r.id)).toEqual(["c1", "c0", "c2"]);
  });
});

describe("agent.judgeRank() — Task 6 public facade", () => {
  const agentsToDispose: Array<{ dispose: () => Promise<void> }> = [];
  afterEach(async () => {
    while (agentsToDispose.length > 0) {
      await agentsToDispose.pop()!.dispose();
    }
  });

  it("(e) ABSENCE: agent.judgeRank() without .withJudgment() rejects with a clear error", async () => {
    const agent = await ReactiveAgents.create()
      .withName("no-judgment-rank-agent")
      .withProvider("test")
      .withTestScenario([{ text: "FINAL ANSWER: done" }])
      .withReasoning({ defaultStrategy: "reactive" })
      .build();
    agentsToDispose.push(agent);

    await expect(
      agent.judgeRank(
        [{ id: "a", state: { text: "candidate a" } }],
        question
      )
    ).rejects.toThrow(/agent\.judgeRank\(\) requires \.withJudgment\(\)/);
  });
});
