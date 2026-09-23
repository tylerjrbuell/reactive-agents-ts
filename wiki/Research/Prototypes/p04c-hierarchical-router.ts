// p04c-hierarchical-router.ts
//
// ─── HYPOTHESIS ────────────────────────────────────────────────────────────────
//
// The MissionBrief asked this probe to compare "the current single-shot
// 8-way Choice (strategy-selection / complexity-router) against a simulated
// 2-stage coarse-then-fine Choice, using real jev calls on the same real
// cases already collected for those sites in wiki/Research/Harness-Reports".
// Two corrections to that framing, made explicit before any data was
// collected (per Research Discipline: report what's real, not what was
// assumed):
//   1. The production strategy-selection Choice (adaptive-judgment-
//      questions.ts) is a 5-way Choice (reactive/reflexion/plan-execute-
//      reflect/tree-of-thought/blueprint), not 8-way — verified by reading
//      the file. complexity-router.ts's Choice is 3-way (haiku/sonnet/opus).
//      This probe tests the 5-way strategy-selection Choice, since that's
//      the site with a meaningful coarse/fine split (3-way complexity tiers
//      don't decompose further).
//   2. wiki/Research/Harness-Reports/2026-09-23-shadow-site-exit-gates.md
//      documents a 31-task real run for this exact site (74.2% agreement)
//      but its "Method" section states the scoring script was "not
//      committed — ad hoc measurement run" — no raw per-case JSON exists in
//      the repo to reuse. Grepped `wiki/Research/Harness-Reports/` for any
//      committed case list; none found. This probe therefore reuses the
//      SAME 20-case synthetic-but-realistic task set authored for p04a
//      (same file, same spirit as that report's own task selection — "a mix
//      of simple factual questions, moderate multi-step tasks, and complex
//      analysis/design/critique prompts"), not the original unavailable
//      cases. Disclosed here, not silently substituted.
//
// Two-stage design: Stage 1 is a 3-way Choice over coarse groups derived
// from what the 5 sub-strategies are actually FOR (grouping by shared
// intent, read from adaptive-judgment-questions.ts's own STRATEGY_CRITERIA
// text): "direct" (reactive), "iterative-loop" (reflexion, plan-execute-
// reflect), "exploratory" (tree-of-thought, blueprint). Stage 2 fires ONLY
// when the chosen group has >1 member, asking a fine Choice within that
// group.
//
// NULL HYPOTHESIS: the 2-stage split changes the final pick often enough
// (low agreement with the 1-stage pick) that it isn't a safe drop-in
// replacement, and/or costs more in combined latency than the 1-stage call
// (2 round trips, even if individually smaller, don't beat 1 round trip on
// wall-clock).
//
// PROMOTION CRITERIA (WORTH-IT): final-pick agreement with 1-stage >= 85%
// (2-stage isn't silently changing outcomes), AND either latency or token
// count improves meaningfully (>=20%) — the two-stage design would only be
// worth shipping if it's cheaper/faster for equivalent output, since
// agreement alone doesn't justify added complexity.
//
// KILL CRITERIA (NOT-WORTH-IT): agreement < 70%, or 2-stage costs MORE
// latency than 1-stage with no compensating benefit.
//
// PROVIDER: jev (TypeSafe) direct-call.
// CASES: same 20-case set as p04a (see disclosure above).

import { makeJevBackend } from "@reactive-agents/judgment";
import type { QuestionSpecs, JudgmentEntry } from "@reactive-agents/judgment";
import { Effect } from "effect";
import fs from "node:fs";
import path from "node:path";

import {
  buildAdaptiveJudgmentState,
  buildAdaptiveJudgmentQuestions,
  answerToStrategy,
} from "../../../packages/reasoning/src/strategies/adaptive-judgment-questions.js";

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

type SubStrategy = "reactive" | "reflexion" | "plan-execute-reflect" | "tree-of-thought" | "blueprint";

const GROUPS: Record<string, readonly SubStrategy[]> = {
  direct: ["reactive"],
  "iterative-loop": ["reflexion", "plan-execute-reflect"],
  exploratory: ["tree-of-thought", "blueprint"],
};

const GROUP_CRITERIA: Record<string, string> = {
  direct: "The task is answerable directly with straightforward tool use or a short single-hop response — no planning or iterative refinement needed.",
  "iterative-loop": "The task needs an iterative process — either self-critique-and-revise, or reacting to intermediate tool results and adapting mid-course.",
  exploratory: "The task needs exploring/comparing multiple approaches or trade-offs, OR a fully decomposable static multi-step plan known up front.",
};

const FINE_CRITERIA: Record<SubStrategy, string> = {
  reactive: "Direct tool use for a short, simple, single-hop task — straightforward Q&A or lookup, no planning overhead.",
  reflexion: "Iterative critique-and-refine loop: produce output, self-review it against a quality bar, and revise.",
  "plan-execute-reflect": "Multi-step task that must adapt mid-course — react to intermediate tool results, debug until passing, investigate, branch on what's observed.",
  "tree-of-thought": "Explore and compare multiple alternative approaches, brainstorm options, or weigh trade-offs between them.",
  blueprint: "Decomposable, tool-heavy task whose full plan is knowable up front and does NOT depend on observing intermediate results — static multi-file/artifact generation.",
};

function stage1Questions(): QuestionSpecs {
  return { group: { type: "choice", instructions: "Which category best fits `taskDescription`?", criteria: GROUP_CRITERIA } };
}

function stage2Questions(group: string): QuestionSpecs {
  const members = GROUPS[group] ?? [];
  const criteria: Record<string, string> = {};
  for (const m of members) criteria[m] = FINE_CRITERIA[m];
  return { strategy: { type: "choice", instructions: "Which reasoning strategy best fits `taskDescription`?", criteria } };
}

interface CaseOutcome {
  readonly task: string;
  readonly oneStagePick: string | null;
  readonly oneStageLatencyMs: number;
  readonly twoStageGroup: string;
  readonly twoStagePick: string;
  readonly twoStageLatencyMs: number;
  readonly twoStageCallCount: number;
  readonly agree: boolean;
}

async function main() {
  const apiKey = process.env.TYPESAFE_API_KEY;
  if (!apiKey) {
    console.error("TYPESAFE_API_KEY not set — aborting.");
    process.exit(1);
  }
  const backend = makeJevBackend({ apiKey });
  const outcomes: CaseOutcome[] = [];

  for (const task of CASES) {
    const state: JudgmentEntry = buildAdaptiveJudgmentState({
      taskDescription: task,
      taskType: "general",
      availableTools: [],
    });

    // 1-stage (production shape): full 5-way Choice + the 3 speculative Nouls.
    const t0 = Date.now();
    const oneStageAnswers = await Effect.runPromise(
      backend.evaluate({ state, questions: buildAdaptiveJudgmentQuestions() }),
    );
    const oneStageLatencyMs = Date.now() - t0;
    const oneStagePick = answerToStrategy(oneStageAnswers.strategy);

    // 2-stage: coarse Choice, then fine Choice only if the group has >1 member.
    const t1 = Date.now();
    const stage1Answers = await Effect.runPromise(backend.evaluate({ state, questions: stage1Questions() }));
    const group = stage1Answers.group.kind === "choice" ? stage1Answers.group.value : "direct";
    let twoStagePick: string;
    let twoStageCallCount = 1;
    const members = GROUPS[group] ?? [];
    if (members.length <= 1) {
      twoStagePick = members[0] ?? "reactive";
    } else {
      const stage2Answers = await Effect.runPromise(backend.evaluate({ state, questions: stage2Questions(group) }));
      twoStagePick = stage2Answers.strategy.kind === "choice" ? stage2Answers.strategy.value : members[0]!;
      twoStageCallCount = 2;
    }
    const twoStageLatencyMs = Date.now() - t1;

    const outcome: CaseOutcome = {
      task,
      oneStagePick,
      oneStageLatencyMs,
      twoStageGroup: group,
      twoStagePick,
      twoStageLatencyMs,
      twoStageCallCount,
      agree: oneStagePick === twoStagePick,
    };
    outcomes.push(outcome);
    console.log(
      `1-stage=${oneStagePick} (${oneStageLatencyMs}ms)  2-stage=${twoStagePick} via ${group} [${twoStageCallCount} call(s), ${twoStageLatencyMs}ms]  agree=${outcome.agree}  task="${task.slice(0, 40)}..."`,
    );
  }

  const outPath = path.join(import.meta.dirname, "spike-results", "p04c-hierarchical-router.json");
  fs.writeFileSync(outPath, JSON.stringify(outcomes, null, 2));
  console.log(`\nWrote ${outPath}`);

  const n = outcomes.length;
  const agreeCount = outcomes.filter((o) => o.agree).length;
  const oneStageTotal = outcomes.reduce((s, o) => s + o.oneStageLatencyMs, 0);
  const twoStageTotal = outcomes.reduce((s, o) => s + o.twoStageLatencyMs, 0);
  const avgCalls = outcomes.reduce((s, o) => s + o.twoStageCallCount, 0) / n;

  console.log(`\nSUMMARY (n=${n}):`);
  console.log(`  agreement: ${agreeCount}/${n} (${((agreeCount / n) * 100).toFixed(1)}%)`);
  console.log(`  latency: 1-stage total=${oneStageTotal}ms  2-stage total=${twoStageTotal}ms  ratio=${(twoStageTotal / oneStageTotal).toFixed(3)}`);
  console.log(`  avg 2-stage call count: ${avgCalls.toFixed(2)}`);
}

main();
