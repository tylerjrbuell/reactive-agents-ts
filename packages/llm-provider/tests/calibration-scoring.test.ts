// Zero-token pins for the v3 calibration probe scoring + discrimination gate.
import { describe, it, expect } from "bun:test";
import {
  ATTENTION_TOKEN,
  ATTENTION_TURNS,
  RESULT_QUESTION,
  RESULT_SIZE_FLOOR,
  RESULT_SIZE_LADDER,
  RESULT_TARGET,
  STEERING_CONFLICTS,
  answersResultQuestion,
  buildResultPayload,
  discriminationGate,
  keepsAttentionRule,
  scoreAttention,
  scoreResultSize,
  scoreSteering,
  stripThinking,
} from "../src/calibration-scoring.js";
import type { ModelCalibration } from "../src/calibration.js";

describe("calibration-scoring seam: steering", () => {
  const [endWord, letterCase, prefix] = STEERING_CONFLICTS;

  // Replies recorded from the 2026-11-10 prototype run (llama3.2:3b obeyed the
  // user rule on every pair; cogito:8b the system rule on 2 of 3).
  it("judges which channel's rule each reply obeyed", () => {
    expect(endWord!.judge("Dolphins and whales. ALPHA")).toBe("system");
    expect(endWord!.judge("Dolphins and whales live in the sea. OMEGA.")).toBe("user");
    expect(endWord!.judge("Dolphins and whales.")).toBe("none");
    expect(letterCase!.judge("DOLPHINS AND WHALES.")).toBe("system");
    expect(letterCase!.judge("dolphins and whales.")).toBe("user");
    expect(letterCase!.judge("Dolphins and whales.")).toBe("none");
    expect(prefix!.judge("Sure: dolphins and whales.")).toBe("system");
    expect(prefix!.judge("Okay: dolphins and whales.")).toBe("user");
    expect(prefix!.judge("Dolphins and whales.")).toBe("none");
  });

  it("ignores an inline <think> block", () => {
    expect(prefix!.judge("<think>\nOkay: which rule?\n</think>\nSure: dolphins.")).toBe("system");
    expect(stripThinking("<think>x</think> hi")).toBe("hi");
  });

  // RED-on-cut: v2 returned "hybrid" when every channel passed AND when none did.
  it("every declared value is reachable; hybrid only on an even split", () => {
    expect(scoreSteering(["system", "user", "system"])).toBe("system-prompt");
    expect(scoreSteering(["user", "user", "user"])).toBe("user-message");
    expect(scoreSteering(["system", "user", "none"])).toBe("hybrid");
    expect(scoreSteering(["none", "none", "none"])).toBe("hybrid");
  });
});

describe("calibration-scoring seam: system-prompt attention", () => {
  it("reads the rule at the end of each reply", () => {
    expect(keepsAttentionRule(`7\n${ATTENTION_TOKEN}`)).toBe(true);
    expect(keepsAttentionRule(`7\n${ATTENTION_TOKEN}\n`)).toBe(true);
    expect(keepsAttentionRule("7")).toBe(false);
    expect(keepsAttentionRule(`${ATTENTION_TOKEN} 7`)).toBe(false);
  });

  // RED-on-cut: v2 scored only the last turn, so "moderate" could not occur.
  it("every declared value is reachable from per-turn compliance", () => {
    expect(scoreAttention(Array<boolean>(ATTENTION_TURNS.length).fill(true))).toBe("strong");
    // cogito:8b prototype run, 2026-11-10: 1011111011
    expect(scoreAttention([true, false, true, true, true, true, true, false, true, true])).toBe("moderate");
    expect(scoreAttention([true, true, true, false, false, false])).toBe("moderate");
    expect(scoreAttention([true, true, false, false, false, false])).toBe("weak");
    expect(scoreAttention([])).toBe("weak");
  });

  it("dropping the rule mid-conversation is not strong even if the last turn keeps it", () => {
    expect(scoreAttention([true, false, false, true, true, true])).toBe("moderate");
  });
});

describe("calibration-scoring seam: tool-result size", () => {
  const recordOf = (points: number) => new RegExp(`team ${RESULT_TARGET.team} scored ${points} points\\.`, "g");

  it("builds a payload of exactly the requested size holding both target games", () => {
    for (const size of RESULT_SIZE_LADDER) {
      const p = buildResultPayload(size);
      expect(p.length).toBe(size);
      for (const g of RESULT_TARGET.games) expect(p.match(recordOf(g))?.length).toBe(1);
      expect(p.match(new RegExp(`team ${RESULT_TARGET.team}`, "g"))?.length).toBe(2);
      // no score or game id equals the total, so a reply cannot pass by echoing one
      expect(p.match(new RegExp(`\\b${RESULT_TARGET.total}\\b`))).toBeNull();
    }
  });

  it("the target games sum to the total and the question names the team", () => {
    expect(RESULT_TARGET.games.reduce((a, b) => a + b, 0)).toBe(RESULT_TARGET.total);
    expect(RESULT_QUESTION).toContain(RESULT_TARGET.team);
  });

  it("is deterministic", () => {
    expect(buildResultPayload(4000)).toBe(buildResultPayload(4000));
  });

  it("an answer counts when it states the total", () => {
    expect(answersResultQuestion("30 + 12 = 42")).toBe(true);
    expect(answersResultQuestion("**42**")).toBe(true);
    expect(answersResultQuestion("The otters scored 30 points.")).toBe(false);
    expect(answersResultQuestion("I could not find it.")).toBe(false);
  });

  it("the ladder reaches above 2000 and every rung is a reachable value", () => {
    expect(Math.max(...RESULT_SIZE_LADDER)).toBeGreaterThan(2000);
    expect(scoreResultSize([[1000, false]])).toBe(RESULT_SIZE_FLOOR);
    const all = RESULT_SIZE_LADDER.map((s) => [s, true] as const);
    expect(scoreResultSize(all)).toBe(8000);
    expect(scoreResultSize([[1000, true], [2000, true], [4000, false]])).toBe(2000);
    expect(scoreResultSize([[1000, true], [2000, true], [4000, true], [8000, false]])).toBe(4000);
  });

  it("stops at the first failure even if a larger size passed", () => {
    expect(scoreResultSize([[1000, true], [2000, false], [4000, true]])).toBe(1000);
  });
});

type Gated = Pick<
  ModelCalibration,
  "steeringCompliance" | "parallelCallCapability" | "observationHandling" | "systemPromptAttention" | "optimalToolResultChars"
>;

// The 9 committed probe-v2 calibrations (src/calibrations/*.json as of
// 2026-11-10), gated fields only.
const v2Set: readonly Gated[] = [
  ["reliable", "uses-recall"], // cogito-14b
  ["sequential-only", "uses-recall"], // cogito-8b
  ["reliable", "uses-recall"], // gemma4-e4b
  ["sequential-only", "needs-inline-facts"], // llama3.2-3b
  ["sequential-only", "needs-inline-facts"], // llama3.2-latest
  ["sequential-only", "needs-inline-facts"], // qwen2.5-coder-14b
  ["sequential-only", "needs-inline-facts"], // qwen2.5-coder-7b
  ["reliable", "uses-recall"], // qwen3-14b
  ["reliable", "uses-recall"], // qwen3-4b
].map(([parallel, recall]) => ({
  steeringCompliance: "hybrid",
  parallelCallCapability: parallel as Gated["parallelCallCapability"],
  observationHandling: recall as Gated["observationHandling"],
  systemPromptAttention: "strong",
  optimalToolResultChars: 2000,
}));

describe("calibration-scoring seam: discrimination gate", () => {
  it("the v2 committed set fails on exactly steering, attention and result size", () => {
    const r = discriminationGate(v2Set);
    expect(r.passes).toBe(false);
    expect(r.models).toBe(9);
    expect(r.fields.filter((f) => !f.passes).map((f) => f.field)).toEqual([
      "steeringCompliance",
      "systemPromptAttention",
      "optimalToolResultChars",
    ]);
  });

  it("passes when every gated field spreads across enough models", () => {
    const spread = v2Set.map((c, i) => ({
      ...c,
      steeringCompliance: i % 2 === 0 ? ("hybrid" as const) : ("user-message" as const),
      systemPromptAttention: i % 3 === 0 ? ("moderate" as const) : ("strong" as const),
      optimalToolResultChars: i < 4 ? 4000 : 8000,
    }));
    expect(discriminationGate(spread).passes).toBe(true);
  });

  it("fails below the model floor even when fields spread", () => {
    const few = v2Set.slice(0, 5).map((c, i) => ({ ...c, steeringCompliance: i ? ("hybrid" as const) : ("system-prompt" as const), systemPromptAttention: i ? ("strong" as const) : ("weak" as const), optimalToolResultChars: i ? 2000 : 4000 }));
    const r = discriminationGate(few);
    expect(r.fields.every((f) => f.passes)).toBe(true);
    expect(r.passes).toBe(false);
  });
});
