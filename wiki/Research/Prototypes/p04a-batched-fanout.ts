// p04a-batched-fanout.ts
//
// ─── HYPOTHESIS ────────────────────────────────────────────────────────────────
//
// The three run-start judgment shadow sites — strategy-selection
// (adaptive-judgment-questions.ts, Task 9), complexity-router
// (judgment-complexity-questions.ts, Task 9b), and task-comprehension
// (judgment-comprehend-questions.ts, Task 10) — all fire on the SAME agent
// run, in the same run-start window (confirmed by code trace: complexity
// routing runs during model-tier selection before the strategy dispatches;
// adaptive's strategy-selection shadow fires right after strategy dispatch;
// task-comprehension fires during the kernel's early "comprehend" phase —
// all three consume nothing but `task`/`taskDescription`, no dependency on
// each other's output). Today each site independently constructs its own
// `JudgmentEntry` state + `QuestionSpecs` and calls `JudgmentService.ask()`
// separately (3 real API round trips per run). If those three states/question
// sets are merged into ONE `ask()` call sharing one state, latency should
// drop roughly 3x → ~1x (minus one call's overhead) with no answer-quality
// degradation, since all three sites already state their own state as
// `{task: ...}`-only or a strict superset of it.
//
// NULL HYPOTHESIS: batching either (a) doesn't reduce wall-clock latency
// meaningfully (the backend can't pipeline that many questions faster than
// 3 separate smaller calls), or (b) degrades individual answers (models drop
// accuracy on judgment when asked too many unrelated questions in one call).
//
// METHOD: 20 representative task descriptions (synthetic-but-realistic,
// spanning the same complexity range as the 2026-09-23 shadow-site-exit-gate
// report's 31-task set — that report's raw per-case data was NOT committed
// to the repo, i.e. not reusable verbatim, so this probe authors its own set
// in the same spirit, disclosed here as synthetic). For each task:
//   (1) UNBATCHED: 3 separate real jev `ask()` calls, one per site, using
//       each site's real production state/question builders verbatim.
//   (2) BATCHED: 1 real jev `ask()` call merging all 3 sites' states into one
//       superset state object and all 3 sites' QuestionSpecs into one
//       QuestionSpecs map (10 questions total: tier, requires-code-execution,
//       multi-step-analysis, strategy, explicit-steps-given,
//       requires-retries-or-debugging, single-hop-answerable, complexity,
//       long-horizon, multi-step, output-format, citation-needed — de-duped
//       where question ids collide across sites, e.g. "multi-step-analysis"
//       vs "multi-step" kept distinct since their instructions differ).
// Measures per task: unbatched total latency (sum of 3 calls) vs batched
// latency (1 call); and per-question answer agreement between the batched
// and unbatched runs (same question id, same instructions/criteria — do the
// judged values match?).
//
// PROMOTION CRITERIA (WORTH-IT): batched median latency <= 50% of unbatched
// summed latency, AND >=90% per-question answer agreement between batched vs
// unbatched runs (same case, same question).
//
// KILL CRITERIA (NOT-WORTH-IT): batched latency >= 80% of unbatched, OR
// answer agreement < 80% (batching measurably degrades judgment quality).
//
// PROVIDER: jev (TypeSafe), no LLM/SUT call — direct JudgmentBackend calls.
// CASES: 20 synthetic-but-realistic task descriptions.
// RUNS: 1 pass per case per condition (both conditions same case set).

import { makeJevBackend } from "@reactive-agents/judgment";
import type { QuestionSpecs, JudgmentEntry, JudgmentAnswer } from "@reactive-agents/judgment";
import { Effect } from "effect";
import fs from "node:fs";
import path from "node:path";

import {
  buildAdaptiveJudgmentState,
  buildAdaptiveJudgmentQuestions,
} from "../../../packages/reasoning/src/strategies/adaptive-judgment-questions.js";
import {
  buildComprehendJudgmentState,
  buildComprehendJudgmentBaseQuestions,
} from "../../../packages/reasoning/src/kernel/capabilities/comprehend/judgment-comprehend-questions.js";

// complexity-router's question builder lives in @reactive-agents/cost but is
// not exported from the package's public index (internal to routing/) — the
// MissionBrief authorizes read-only use of packages/cost/src/routing/**, so
// this probe inlines the SAME criteria text verbatim from
// packages/cost/src/routing/judgment-complexity-questions.ts rather than
// importing a private module path across a package boundary.
const TIER_CRITERIA: Record<string, string> = {
  haiku:
    "Cheapest, fastest tier. Use for simple lookups, short Q&A, direct tool calls with no multi-step reasoning or deep analysis needed.",
  sonnet:
    "Balanced tier. Use for moderate complexity — some code, some analysis, or a short multi-step task, but not requiring the highest reasoning quality.",
  opus:
    "Highest-quality, slowest, most expensive tier. Use for tasks combining code generation, multi-step planning, AND deep analysis/synthesis together — genuinely hard tasks.",
};
const buildComplexityJudgmentState = (task: string): JudgmentEntry => ({ task });
const buildComplexityJudgmentQuestions = (): QuestionSpecs => ({
  tier: {
    type: "choice",
    instructions: "Which model tier is the best cost/quality/latency fit for completing `task`?",
    criteria: TIER_CRITERIA,
  },
  "requires-code-execution": {
    type: "noul",
    instructions: "Does `task` require writing or executing code?",
  },
  "multi-step-analysis": {
    type: "noul",
    instructions: "Does `task` require multi-step reasoning, comparison, or deep analysis rather than a direct answer?",
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

const state = (task: string, taskType: string, tools: readonly string[]) => ({
  complexity: buildComplexityJudgmentState(task),
  adaptive: buildAdaptiveJudgmentState({ taskDescription: task, taskType, availableTools: tools }),
  comprehend: buildComprehendJudgmentState({ task }),
});

const mergedState = (task: string, taskType: string, tools: readonly string[]): JudgmentEntry => ({
  task,
  taskDescription: task,
  taskType,
  toolsAvailable: tools.length > 0,
  toolCount: tools.length,
});

const mergedQuestions = (): QuestionSpecs => ({
  ...buildComplexityJudgmentQuestions(),
  ...buildAdaptiveJudgmentQuestions(),
  ...buildComprehendJudgmentBaseQuestions(),
});

interface CaseResult {
  readonly task: string;
  readonly unbatchedLatencyMs: number;
  readonly batchedLatencyMs: number;
  readonly perQuestionAgreement: Record<string, { unbatched: string | number; batched: string | number; agree: boolean }>;
}

// Comparable, bucketed value per answer kind — NOT raw float equality.
// Noul/Score answers are continuous and won't exactly match across two
// separate API calls even with zero real behavior change (the backend isn't
// bit-exact deterministic); bucketing (noul -> boolean at 0.5, score ->
// rounded integer level) is the same tolerance the shadow-site production
// code itself uses (`answerToBoolean`, `answerToComplexity`). Choice stays
// exact-string since it's categorical.
const answerValue = (a: JudgmentAnswer): string | number =>
  a.kind === "noul" ? (a.probability >= 0.5 ? 1 : 0) : a.kind === "score" ? Math.round(a.value) : a.value;

// Raw (unbucketed) value, kept alongside for the RESULTS write-up so the
// magnitude of any float drift is visible, not just the boolean verdict.
const rawAnswerValue = (a: JudgmentAnswer): string | number =>
  a.kind === "noul" ? a.probability : a.kind === "score" ? a.value : a.value;

async function main() {
  const apiKey = process.env.TYPESAFE_API_KEY;
  if (!apiKey) {
    console.error("TYPESAFE_API_KEY not set — aborting (no fallback, no fabricated numbers).");
    process.exit(1);
  }
  const backend = makeJevBackend({ apiKey });
  const results: CaseResult[] = [];

  for (const task of CASES) {
    const taskType = "general";
    const tools: readonly string[] = [];

    // --- UNBATCHED: 3 separate calls ---
    const unbatchedStart = Date.now();
    const [complexityAns, adaptiveAns, comprehendAns] = await Promise.all([
      Effect.runPromise(
        backend.evaluate({ state: buildComplexityJudgmentState(task), questions: buildComplexityJudgmentQuestions() }),
      ),
      Effect.runPromise(
        backend.evaluate({
          state: buildAdaptiveJudgmentState({ taskDescription: task, taskType, availableTools: tools }),
          questions: buildAdaptiveJudgmentQuestions(),
        }),
      ),
      Effect.runPromise(
        backend.evaluate({ state: buildComprehendJudgmentState({ task }), questions: buildComprehendJudgmentBaseQuestions() }),
      ),
    ]);
    const unbatchedLatencyMs = Date.now() - unbatchedStart;
    const unbatchedAnswers: Record<string, JudgmentAnswer> = {
      ...complexityAns,
      ...adaptiveAns,
      ...comprehendAns,
    };

    // --- BATCHED: 1 call ---
    const batchedStart = Date.now();
    const batchedAnswers = await Effect.runPromise(
      backend.evaluate({ state: mergedState(task, taskType, tools), questions: mergedQuestions() }),
    );
    const batchedLatencyMs = Date.now() - batchedStart;

    const perQuestionAgreement: CaseResult["perQuestionAgreement"] = {};
    for (const id of Object.keys(mergedQuestions())) {
      const u = unbatchedAnswers[id];
      const b = batchedAnswers[id];
      if (!u || !b) continue;
      const uv = answerValue(u);
      const bv = answerValue(b);
      perQuestionAgreement[id] = {
        unbatched: rawAnswerValue(u),
        batched: rawAnswerValue(b),
        agree: uv === bv,
      };
    }

    results.push({ task, unbatchedLatencyMs, batchedLatencyMs, perQuestionAgreement });
    console.log(
      `[${results.length}/${CASES.length}] unbatched=${unbatchedLatencyMs}ms batched=${batchedLatencyMs}ms task="${task.slice(0, 40)}..."`,
    );
  }

  const outPath = path.join(import.meta.dirname, "spike-results", "p04a-batched-fanout.json");
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log(`\nWrote ${outPath}`);

  const unbatchedTotal = results.reduce((s, r) => s + r.unbatchedLatencyMs, 0);
  const batchedTotal = results.reduce((s, r) => s + r.batchedLatencyMs, 0);
  let agree = 0;
  let total = 0;
  for (const r of results) {
    for (const q of Object.values(r.perQuestionAgreement)) {
      total++;
      if (q.agree) agree++;
    }
  }
  console.log(`\nSUMMARY: unbatched total=${unbatchedTotal}ms batched total=${batchedTotal}ms ratio=${(batchedTotal / unbatchedTotal).toFixed(3)}`);
  console.log(`Per-question agreement: ${agree}/${total} (${((agree / total) * 100).toFixed(1)}%)`);
}

main();
