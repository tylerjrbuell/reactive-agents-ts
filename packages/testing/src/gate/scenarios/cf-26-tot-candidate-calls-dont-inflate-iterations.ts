// packages/testing/src/gate/scenarios/cf-26-tot-candidate-calls-dont-inflate-iterations.ts
//
// Targeted weakness: W5 — tree-of-thought candidate (BFS expansion/scoring)
// LLM calls inflate the execution iteration counter.
//
// Investigation (Wave 7.2): the weakness does NOT reproduce on the current
// tree — ToT accounts BFS candidate calls in metadata.llmCalls while engine
// iterations track loop passes (measured: bounded iterations alongside
// multi-call candidate volume on a breadth-3 scripted run). This scenario
// pins the ABSENCE as a guard: BFS candidate volume must never leak into the
// iteration counter the watchdog/maxIterations gates read.
//
// Regression triggered when: a ToT run's trace iterations exceed its engine
// loop passes, i.e. candidate/scoring LLM calls get counted as iterations.
//
// Promoted from scaffold cf-TODO-w5-tree-of-thought-candidate-llm-calls-infl
// (gate:propose emit); the scaffold file is deleted in the same commit.
// Requires the Wave 7.2 ScenarioConfig.strategy field (this scenario drives
// tree-of-thought, not the default reactive).

import type { ScenarioModule } from "../types.js";

export const scenario: ScenarioModule = {
  id: "cf-26-tot-candidate-calls-dont-inflate-iterations",
  targetedWeakness: "W5",
  closingCommit: "Wave-7.2-guard",
  description:
    "ToT BFS candidate (expansion/scoring) LLM calls are accounted in metadata.llmCalls and must never inflate the trace iteration count: iterations stay bounded by engine loop passes regardless of candidate volume. Fails if candidate calls leak into the iteration counter the watchdog/maxIterations gates read.",
  config: {
    name: "cf-26-tot-candidate-calls-dont-inflate-iterations",
    // Must NOT classify trivial (short-prose rule): trivial tasks skip BFS
    // entirely (verified: a 5-word task classified trivial/0.7 → 1 LLM call,
    // guard vacuous). Moderate forces full breadth-3 BFS.
    task: "Compare three database migration approaches across cost, risk, and downtime, then recommend one with justification.",
    strategy: "tree-of-thought",
    testTurns: [
      { match: "Generate exactly", text: "1. Approach alpha\n2. Approach beta\n3. Approach gamma" },
      { match: "Rate each", text: "1: 0.8\n2: 0.7\n3: 0.6" },
      { match: "Selected Approach", text: "FINAL ANSWER: done." },
      { text: "FINAL ANSWER: done." },
    ],
    maxIterations: 8,
  },
  customAssertions: (result) => {
    const isRecord = (v: unknown): v is Record<string, unknown> =>
      typeof v === "object" && v !== null;
    const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
    let llmExchanges = 0;
    let iterations = 0;
    for (const e of result.trace.events) {
      if (!isRecord(e)) continue;
      const kind = str(e.kind) ?? str(e._tag) ?? "";
      if (kind === "llm-exchange") llmExchanges += 1;
      if (kind === "assessment" && typeof e.iter === "number" && e.iter > iterations) {
        iterations = e.iter;
      }
    }
    return {
      // Candidate volume happened (BFS ran: expansion + scoring calls).
      // Floor pins the guard non-vacuous: if BFS ever silently stops
      // running (e.g. a classifier change), this fails instead of passing
      // on an empty run.
      "tot.llm-exchanges": llmExchanges,
      "tot.bfs-ran": llmExchanges >= 5 ? true : false,
      // ...but stayed out of the iteration counter (engine passes bounded).
      // Bound is tight (<=2 vs observed 0): a 1-2 iteration leak — the actual
      // failure mode — fails instead of hiding in headroom.
      "tot.max-assessed-iter": iterations,
      "tot.iterations-bounded": iterations <= 2 ? true : false,
    };
  },
};
