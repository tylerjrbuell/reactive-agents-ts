// p04d-state-presentation-bias.ts
//
// ─── HYPOTHESIS ────────────────────────────────────────────────────────────────
//
// The complexity-router (Task 9b) shadow site's 2026-09-23 real-run agreement
// with the regex heuristic was 93.5% (29/31) — already high, but the
// MissionBrief's underlying question generalizes: strategy-selection/
// complexity-router disagreement (74.2% for strategy-selection) MAY partly
// come from weak STATE PRESENTATION to jev (today: `{task: string}`, one
// unlabeled field), not from the routing shape itself being wrong. Per
// docs.typesafe.ai/concepts/state (fetched live for this probe): "use an
// object for most requests so each part of the state has a descriptive
// name," "group related information together," and keep questions (not
// state) responsible for criteria — state should carry FACTS, not
// instructions. This probe tests complexity-router's Choice (chosen over
// strategy-selection's because it has an existing standalone, exported,
// deterministic heuristic — `heuristicClassify` — to compare against,
// whereas strategy-selection's heuristic logic lives un-exported inside
// `adaptive.ts` and isn't reusable without duplicating undocumented
// internals).
//
// NULL HYPOTHESIS: enriching the state payload with descriptively-named
// derived facts (word count, keyword-presence booleans, explicit "first
// turn" context) makes no measurable difference to agreement with the
// heuristic — meaning the site's disagreement is a genuine reasoning-shape
// gap (jev vs regex read the task differently), not a presentation artifact.
//
// METHOD: same 20-case set as p04a/p04c (see disclosure in those files —
// the original 31 real-run cases from the 2026-09-23 report were not
// committed to the repo as raw data). For each case, two conditions:
//   (a) CURRENT: `buildComplexityJudgmentState({task})` verbatim — the real
//       shipped state builder, `{task: string}`.
//   (b) ENRICHED: a structured object with descriptively-named fields
//       derived deterministically from `task` (no LLM, no hand-labeling):
//       `taskText`, `taskWordCount`, `mentionsCodeKeyword`,
//       `mentionsMultiStepKeyword`, `mentionsAnalysisKeyword`, and an
//       explicit `conversationContext: "first turn of a new run, no prior
//       context"` field — facts only, no criteria duplication (the Choice
//       criteria stay in the question, unchanged, per the docs guidance
//       above).
// Same `buildComplexityJudgmentQuestions()` (unchanged) used for both
// conditions — isolates presentation from question/routing shape.
// Agreement baseline: `heuristicClassify(task)` (real, exported, unmodified
// production heuristic from complexity-router.ts).
//
// PROMOTION CRITERIA (WORTH-IT): enriched-state agreement >= current-state
// agreement + 10pp (a real, non-trivial lift attributable to presentation
// alone).
//
// KILL CRITERIA (NOT-WORTH-IT / INCONCLUSIVE): enriched agreement within
// +/-5pp of current (no meaningful effect — disagreement is a routing-shape
// issue, not a presentation issue), or enriched agreement is LOWER (richer
// state actively hurts here).
//
// PROVIDER: jev (TypeSafe) direct-call.
// CASES: same 20-case set as p04a/p04c.

import { makeJevBackend } from "@reactive-agents/judgment";
import type { JudgmentEntry } from "@reactive-agents/judgment";
import { Effect } from "effect";
import fs from "node:fs";
import path from "node:path";

import { heuristicClassify } from "../../../packages/cost/src/routing/complexity-router.js";

const TIER_CRITERIA: Record<string, string> = {
  haiku:
    "Cheapest, fastest tier. Use for simple lookups, short Q&A, direct tool calls with no multi-step reasoning or deep analysis needed.",
  sonnet:
    "Balanced tier. Use for moderate complexity — some code, some analysis, or a short multi-step task, but not requiring the highest reasoning quality.",
  opus:
    "Highest-quality, slowest, most expensive tier. Use for tasks combining code generation, multi-step planning, AND deep analysis/synthesis together — genuinely hard tasks.",
};
type QSpecs = { tier: { type: "choice"; instructions: string; criteria: Record<string, string> } };
const buildComplexityJudgmentQuestions = (): QSpecs => ({
  tier: {
    type: "choice",
    instructions: "Which model tier is the best cost/quality/latency fit for completing the task described in state?",
    criteria: TIER_CRITERIA,
  },
});

const CASES: readonly string[] = [
  "What is the capital of France?",
  "Convert 250 degrees Fahrenheit to Celsius.",
  "Write a haiku about autumn leaves.",
  "List the first 5 prime numbers.",
  "What year did the Berlin Wall fall?",
  "Summarize the plot of Romeo and Juliet in two sentences.",
  "First, fetch the current weather for Tokyo, then convert the temperature to Fahrenheit.",
  "Write a Python function that reverses a linked list, then explain its time complexity.",
  "Debug this script: it throws a KeyError on line 12, find the root cause and fix it.",
  "Plan a 3-day itinerary for visiting Kyoto, including transportation between sites.",
  "Refactor this authentication module to use JWT instead of session cookies, step by step.",
  "Investigate why the checkout API is returning 500 errors intermittently and propose a fix.",
  "Compare and critique three different database indexing strategies for a high-write workload.",
  "Evaluate the trade-offs between microservices and a monolith for a 5-person startup, and justify a recommendation.",
  "Analyze this quarterly earnings report and identify the three biggest risks to next year's revenue.",
  "Design a caching architecture for a read-heavy API, weighing Redis vs a CDN vs in-process caching.",
  "Give me a JSON object with the top 5 programming languages by 2025 popularity, with a `rank` and `name` field.",
  "Produce a CSV of the last 12 months with columns date,revenue,expenses using this data as input.",
  "Cite the primary sources for the claim that coffee consumption reduces Parkinson's risk.",
  "Write a bulleted list of pros and cons for adopting TypeScript in an existing JavaScript codebase.",
];

function currentState(task: string): JudgmentEntry {
  return { task };
}

function enrichedState(task: string): JudgmentEntry {
  return {
    taskText: task,
    taskWordCount: task.trim().split(/\s+/).length,
    mentionsCodeKeyword: /```|code|function|script|refactor|debug/i.test(task),
    mentionsMultiStepKeyword: /\b(step|then|next|finally|first,)\b/i.test(task),
    mentionsAnalysisKeyword: /\b(analyze|compare|evaluate|critique|trade-?off|weigh|justify)\b/i.test(task),
    conversationContext: "first turn of a new run, no prior context",
  };
}

interface CaseOutcome {
  readonly task: string;
  readonly heuristicTier: string | null;
  readonly currentJevTier: string | null;
  readonly enrichedJevTier: string | null;
  readonly currentAgrees: boolean;
  readonly enrichedAgrees: boolean;
}

async function main() {
  const apiKey = process.env.TYPESAFE_API_KEY;
  if (!apiKey) {
    console.error("TYPESAFE_API_KEY not set — aborting.");
    process.exit(1);
  }
  const backend = makeJevBackend({ apiKey });
  const outcomes: CaseOutcome[] = [];
  const questions = buildComplexityJudgmentQuestions();

  for (const task of CASES) {
    const heuristicTier = heuristicClassify(task);
    const [currentAns, enrichedAns] = await Promise.all([
      Effect.runPromise(backend.evaluate({ state: currentState(task), questions })),
      Effect.runPromise(backend.evaluate({ state: enrichedState(task), questions })),
    ]);
    const currentJevTier = currentAns.tier.kind === "choice" ? currentAns.tier.value : null;
    const enrichedJevTier = enrichedAns.tier.kind === "choice" ? enrichedAns.tier.value : null;

    const outcome: CaseOutcome = {
      task,
      heuristicTier,
      currentJevTier,
      enrichedJevTier,
      currentAgrees: currentJevTier === heuristicTier,
      enrichedAgrees: enrichedJevTier === heuristicTier,
    };
    outcomes.push(outcome);
    console.log(
      `heuristic=${heuristicTier}  current=${currentJevTier} (${outcome.currentAgrees ? "agree" : "DISAGREE"})  enriched=${enrichedJevTier} (${outcome.enrichedAgrees ? "agree" : "DISAGREE"})  task="${task.slice(0, 40)}..."`,
    );
  }

  const outPath = path.join(import.meta.dirname, "spike-results", "p04d-state-presentation-bias.json");
  fs.writeFileSync(outPath, JSON.stringify(outcomes, null, 2));
  console.log(`\nWrote ${outPath}`);

  const n = outcomes.length;
  const currentAgree = outcomes.filter((o) => o.currentAgrees).length;
  const enrichedAgree = outcomes.filter((o) => o.enrichedAgrees).length;
  console.log(`\nSUMMARY (n=${n}):`);
  console.log(`  current-state agreement: ${currentAgree}/${n} (${((currentAgree / n) * 100).toFixed(1)}%)`);
  console.log(`  enriched-state agreement: ${enrichedAgree}/${n} (${((enrichedAgree / n) * 100).toFixed(1)}%)`);
  console.log(`  delta: ${(((enrichedAgree - currentAgree) / n) * 100).toFixed(1)}pp`);
}

main();
