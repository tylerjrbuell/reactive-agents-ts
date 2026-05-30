// task-quality-gate.ts — Real-world synthesis benchmark for the harness.
//
// Parallel to failure-corpus.ts (which tests success/fail booleans on
// adversarial scenarios), this gate tests SYNTHESIS QUALITY on real tasks.
// Each task is scored on multiple quality dimensions, not a single
// success/fail bit.
//
// Why this exists (per North Star v3.0 design philosophy):
//   "How would the human brain handle this task? Would it store an
//    observation and recall it manually or would it make observations
//    that get compressed and distilled into an experience that the agent's
//    memory drives future output from?"
//
// The brain analogy: sensory input → working memory → attention → reasoning
// → output. Recall is automatic + contextual, not "agent must call recall()"
// to retrieve data. The harness's job is to ensure all relevant memories
// are IN-CONTEXT and available for synthesis.
//
// Failure modes this gate catches that the failure-corpus misses:
//   1. Agent calls recall() when context already had the data (architectural smell)
//   2. Agent emits tool-result preview as "synthesis" (echo, not synthesis)
//   3. Agent fabricates values not present in tool observations
//   4. Agent ignores requested format (numbered list, markdown, etc.)
//   5. Agent's output is incomplete (asked for top 5, returned top 3)
//   6. Agent hallucinates tools / parameters not in the schema
//   7. Multi-tool synthesis fails to integrate sources
//
// Each task is scored on quality dimensions:
//   - tool-success: did tools execute correctly
//   - format-adherence: does output match requested format
//   - faithfulness: are cited values present in tool observations
//   - completeness: did it answer the FULL question
//   - no-fabrication: are there hallucinated values
//   - efficiency: tokens / iterations / wall time
//
// Run: bun run .agents/skills/harness-improvement-loop/scripts/task-quality-gate.ts [model]
// Default model: gemma4:e4b. Override: TASK_GATE_MODEL=cogito:14b bun ...
//
// Output: wiki/Research/Harness-Reports/task-quality-gate-<timestamp>.json + console summary

import { ReactiveAgents } from "reactive-agents";
import { Effect } from "effect";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const MODEL = process.env.TASK_GATE_MODEL ?? process.env.PROBE_MODEL ?? "gemma4:e4b";
const PROVIDER = process.env.TASK_GATE_PROVIDER ?? "ollama";
const RECENT_OBS_LIMIT = Number(process.env.TASK_GATE_RECENT_OBS_LIMIT ?? "5");
const RUNS_PER_TASK = Math.max(1, Number(process.env.RUNS_PER_TASK ?? "3"));
const REPORTS_DIR = resolve(process.cwd(), "wiki/Research/Harness-Reports");
const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

// ── Cached HN data so all tasks see the same source-of-truth ────────────────
type HnPost = {
  id: number;
  title: string;
  score: number;
  url: string;
  by?: string;
  descendants?: number;
};

const HN_FIXTURE = process.env.TASK_GATE_HN_FIXTURE;

const HN_CACHE: HnPost[] = await (async () => {
  if (HN_FIXTURE && existsSync(HN_FIXTURE)) {
    const posts = JSON.parse(readFileSync(HN_FIXTURE, "utf8")) as HnPost[];
    console.log(`Loaded ${posts.length} HN posts from fixture ${HN_FIXTURE}`);
    return posts;
  }
  const ids = ((await (await fetch(
    "https://hacker-news.firebaseio.com/v0/topstories.json",
  )).json()) as number[]).slice(0, 30);
  const items = await Promise.all(
    ids.map(async (id) => {
      const r = await (
        await fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`)
      ).json();
      return r as Partial<HnPost>;
    }),
  );
  const posts = items.map((it, i): HnPost => ({
    id: ids[i] as number,
    title: it.title ?? "(no title)",
    score: it.score ?? 0,
    by: it.by,
    descendants: it.descendants ?? 0,
    url: it.url ?? `https://news.ycombinator.com/item?id=${ids[i]}`,
  }));
  if (HN_FIXTURE) {
    writeFileSync(HN_FIXTURE, JSON.stringify(posts, null, 2));
    console.log(`Froze ${posts.length} HN posts to fixture ${HN_FIXTURE}`);
  }
  return posts;
})();

console.log(`Cached ${HN_CACHE.length} HN posts. All tasks will see identical source data.`);

if (process.env.TASK_GATE_FREEZE_ONLY === "1") {
  process.exit(0);
}

// ── Tool: cached HN posts (deterministic) ───────────────────────────────────
const hnTool = {
  definition: {
    name: "get-hn-posts",
    description: "Fetch top Hacker News posts (cached — deterministic).",
    parameters: [
      {
        name: "count",
        type: "number" as const,
        description: "How many top posts (1–30)",
        required: true,
        default: 20,
      },
    ],
    riskLevel: "low" as const,
    timeoutMs: 5_000,
    requiresApproval: false,
    source: "function" as const,
    // Sprint 3.4 Scaffold 1 — single call returns N posts (batch). Tells
    // the classifier NOT to multiply minCalls based on entity count
    // ("summarize 15 posts" doesn't mean 15 invocations).
    cardinality: "batch" as const,
  },
  handler: (args: Record<string, unknown>) =>
    Effect.succeed(
      HN_CACHE.slice(0, Math.min(30, Math.max(1, Number(args.count) || 20))) as unknown,
    ),
};

// ── Quality dimensions ──────────────────────────────────────────────────────
interface QualityScore {
  readonly toolSuccess: boolean;          // tools all executed without error
  readonly formatAdherence: number;       // 0..1 — did output match requested format
  readonly faithfulness: number;          // 0..1 — fraction of cited values present in observations
  readonly completeness: number;          // 0..1 — did it answer the full question
  readonly noFabrication: number;         // 0..1 — 1.0 if no hallucinations detected, scaled down per fabrication
  readonly callsRecall: boolean;          // ★ key signal — agent shouldn't NEED recall() for synthesis
  readonly composite: number;             // weighted average (0..1)
  readonly notes: readonly string[];      // human-readable assessment lines
  readonly strictCorrect?: boolean;       // T3 only — exact match of top-3-by-comments ids (set in Phase 1)
}

interface TaskResult {
  readonly taskId: string;
  readonly taskDescription: string;
  readonly success: boolean;
  readonly tokensUsed: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly stepsCount: number;
  readonly toolCallCount: number;
  readonly wallMs: number;
  readonly output: string;
  readonly quality: QualityScore;
  readonly runIndex: number;              // 0-based run index within the N-run set
  readonly postConditionsMet: null;       // Phase 1 stub — wired to real data in Phase 1
}

// ── Multi-run aggregates ─────────────────────────────────────────────────────
interface TaskRunSet {
  readonly taskId: string;
  readonly taskDescription: string;
  readonly runs: readonly TaskResult[];
  readonly passK: boolean;               // true iff ALL runs succeeded
  readonly passKLabel: string;           // e.g. "3/3" or "1/3"
  readonly compositeMean: number;
  readonly compositeMin: number;
  readonly compositeMax: number;
  readonly compositeSpread: number;      // max − min
  // T3 strict: how many runs had exact correct top-3-by-comments ids
  readonly t3StrictCorrectCount: number | null;  // null for non-T3 tasks
  readonly t3StrictCorrectLabel: string | null;  // e.g. "2/3" or null
  readonly postConditionsMet: null;       // Phase 1 stub
}

interface TaskDef {
  readonly id: string;
  readonly description: string;
  readonly tools: readonly typeof hnTool[];
  readonly task: string;
  readonly score: (output: string, toolCalls: ReadonlyArray<{ name: string }>) => QualityScore;
}

// ── Scoring helpers ─────────────────────────────────────────────────────────
const top5ByScore = [...HN_CACHE.slice(0, 25)].sort((a, b) => b.score - a.score).slice(0, 5);
const top3ByComments = [...HN_CACHE.slice(0, 25)]
  .sort((a, b) => (b.descendants ?? 0) - (a.descendants ?? 0))
  .slice(0, 3);

// The expected IDs for T3 strict correctness
const top3ByCommentsIds = new Set(top3ByComments.map((p) => p.id));

function snippet(t: string, n = 30): string {
  return t.slice(0, Math.min(n, t.length));
}

function compositeOf(s: Omit<QualityScore, "composite" | "notes" | "callsRecall" | "toolSuccess" | "strictCorrect">): number {
  // Weights: faithfulness and noFabrication matter most for trust;
  // completeness and format are user-experience quality.
  return (
    s.faithfulness * 0.35 +
    s.noFabrication * 0.30 +
    s.completeness * 0.20 +
    s.formatAdherence * 0.15
  );
}

function buildQuality(args: {
  toolSuccess: boolean;
  formatAdherence: number;
  faithfulness: number;
  completeness: number;
  noFabrication: number;
  callsRecall: boolean;
  notes: string[];
  strictCorrect?: boolean;
}): QualityScore {
  const composite = compositeOf(args);
  return { ...args, composite };
}

// ── T3 strict correctness: resolve cited post ids from output ────────────────
// Match title snippets (first 20 chars, case-insensitive) from HN_CACHE against
// the agent's output. A run is strict-correct iff the set of distinct cited post
// ids equals EXACTLY the 3 top3ByComments ids — no more, no fewer.
// Order-insensitive. If the agent names 6 posts (3 right + 3 wrong), returns false.
function citedT3Ids(output: string): number[] {
  // Distinct HN_CACHE ids whose 20-char title snippet appears in the output.
  return HN_CACHE.filter((p) => {
    const snip = snippet(p.title, 20).toLowerCase();
    return snip.length > 0 && output.toLowerCase().includes(snip);
  }).map((p) => p.id);
}

function resolveT3StrictCorrect(output: string): boolean {
  const citedIds = new Set(citedT3Ids(output));

  // Exact-set match: must cite exactly the 3 required ids and nothing else.
  return (
    citedIds.size === 3 &&
    [...top3ByCommentsIds].every((id) => citedIds.has(id))
  );
}

// ── Task definitions ────────────────────────────────────────────────────────

const TASKS: TaskDef[] = [
  // T1 — pure synthesis (no tools, sanity check that arch isn't broken)
  {
    id: "T1-knowledge-recall",
    description: "Pure knowledge — no tools needed. Tests baseline arch isn't broken.",
    tools: [],
    task:
      "List the 7 days of the week starting with Monday. Format: numbered markdown list.",
    score: (output) => {
      const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
      const found = days.filter((d) => output.includes(d)).length;
      const completeness = found / 7;
      const isNumberedList = /^\s*1\.|^\s*1\)/m.test(output);
      const formatAdherence = isNumberedList ? 1.0 : 0.5;
      const noFabrication = /Funday|Restday|Octoday/.test(output) ? 0 : 1;
      const notes = [
        `${found}/7 days found`,
        isNumberedList ? "numbered list ✓" : "no numbered list ✗",
      ];
      return buildQuality({
        toolSuccess: true,
        formatAdherence,
        faithfulness: 1.0, // no observations to ground in
        completeness,
        noFabrication,
        callsRecall: false,
        notes,
      });
    },
  },

  // T2 — single-tool synthesis (the original scratch.ts pattern)
  {
    id: "T2-single-tool-synthesis",
    description:
      "Fetch HN posts → produce a numbered markdown list summary. Tests the scratch.ts pattern that exposed the recall-echo bug.",
    tools: [hnTool],
    task:
      "Fetch the top 15 Hacker News posts via get-hn-posts. Then write a numbered markdown list with one line per post in this format: '1. TITLE (score: SCORE)'. Use exact titles and scores from the tool result. Output ONLY the numbered list.",
    score: (output, toolCalls) => {
      const top15 = HN_CACHE.slice(0, 15);
      const titlesFound = top15.filter((p) => output.includes(snippet(p.title))).length;
      const scoresFound = top15.filter((p) => output.includes(`${p.score}`)).length;
      const isNumberedList = /^\s*1\.|^\s*1\)/m.test(output);
      const lineCount = output.split("\n").filter((l) => /^\s*\d+[\.\)]/.test(l)).length;

      // Detect if output is just the recall preview echo (the bug we observed)
      const isToolPreviewEcho =
        output.includes("[recall result") ||
        output.includes("compressed preview") ||
        output.includes("_tool_result_") ||
        output.includes("— full text is stored");

      const callsRecall = toolCalls.some((c) => c.name === "recall");

      return buildQuality({
        toolSuccess: toolCalls.some((c) => c.name === "get-hn-posts"),
        formatAdherence: isNumberedList && lineCount >= 10 ? 1.0 : isNumberedList ? 0.5 : 0,
        faithfulness: titlesFound / 15,
        completeness: Math.min(1, lineCount / 15),
        noFabrication: isToolPreviewEcho ? 0 : 1,
        callsRecall,
        notes: [
          `${titlesFound}/15 titles cited`,
          `${scoresFound}/15 scores cited`,
          `${lineCount} numbered lines`,
          isToolPreviewEcho ? "★ tool-preview echoed as output" : "real synthesis",
          callsRecall ? "★ called recall() (architectural smell)" : "no recall needed",
        ],
      });
    },
  },

  // T3 — selective filter (tests faithfulness when criterion isn't the obvious one)
  {
    id: "T3-selective-filter",
    description:
      "Fetch 25 posts; output top 3 by COMMENTS (not score). Tests filtering accuracy + faithful citation under selection pressure.",
    tools: [hnTool],
    task:
      "Fetch the top 25 Hacker News posts via get-hn-posts. Each post has a 'descendants' field (comment count). Output the 3 posts with the MOST comments in this exact format: '1. TITLE — comments: COUNT'. Sort by comment count descending. Use exact titles from the tool result.",
    score: (output, toolCalls) => {
      const titlesFound = top3ByComments.filter((p) => output.includes(snippet(p.title))).length;
      const commentsFound = top3ByComments.filter((p) =>
        output.includes(`${p.descendants ?? 0}`),
      ).length;

      // Detect score-confusion: did the agent cite top-by-SCORE posts that aren't in top-by-comments?
      const wrongPicks = top5ByScore
        .filter((p) => !top3ByComments.some((c) => c.id === p.id))
        .filter((p) => output.includes(snippet(p.title))).length;

      const isNumberedList = /^\s*1\.|^\s*1\)/m.test(output);
      const lineCount = output.split("\n").filter((l) => /^\s*\d+[\.\)]/.test(l)).length;
      const callsRecall = toolCalls.some((c) => c.name === "recall");

      // STRICT check: exact match of top-3-by-comments post ids
      const strictCorrect = resolveT3StrictCorrect(output);
      const expectedIds = [...top3ByCommentsIds];
      const citedIds = citedT3Ids(output);
      const strictAudit = `strict ${strictCorrect ? "✓" : "✗"} expected=[${expectedIds.join(",")}] cited=[${citedIds.join(",")}]`;

      return buildQuality({
        toolSuccess: toolCalls.some((c) => c.name === "get-hn-posts"),
        formatAdherence: isNumberedList ? Math.min(1, lineCount / 3) : 0.3,
        faithfulness: (titlesFound + commentsFound) / 6, // 3 titles + 3 counts
        completeness: lineCount >= 3 ? 1 : lineCount / 3,
        noFabrication: 1 - wrongPicks * 0.33, // each wrong pick docks 1/3
        callsRecall,
        strictCorrect,
        notes: [
          `${titlesFound}/3 correct titles`,
          `${commentsFound}/3 correct comment counts`,
          wrongPicks > 0 ? `★ ${wrongPicks} score-confusion picks` : "no confusion",
          strictCorrect ? "strict ✓ (exact top-3 ids)" : "★ strict ✗ (wrong post ids)",
          strictAudit,
          callsRecall ? "★ called recall()" : "",
        ].filter((n) => n.length > 0),
      });
    },
  },

  // T4 — multi-criteria synthesis (tests integration of multiple selection rules)
  {
    id: "T4-multi-criteria",
    description:
      "Fetch 20 posts; output 'highest score' AND 'most comments' as two separate sections. Tests synthesis of multiple slices from one observation.",
    tools: [hnTool],
    task:
      "Fetch top 20 Hacker News posts. Output exactly TWO markdown sections: '## Highest Score' (top 3 by score) and '## Most Comments' (top 3 by comment count, the 'descendants' field). Each section: numbered list 'TITLE (NUMBER)'. Use exact titles.",
    score: (output, toolCalls) => {
      const hasScoreSection = /## Highest Score/i.test(output);
      const hasCommentsSection = /## Most Comments/i.test(output);
      const top3ByScoreInTop20 = HN_CACHE.slice(0, 20)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);
      const top3ByCommInTop20 = HN_CACHE.slice(0, 20)
        .sort((a, b) => (b.descendants ?? 0) - (a.descendants ?? 0))
        .slice(0, 3);

      const scoreTitlesFound = top3ByScoreInTop20.filter((p) => output.includes(snippet(p.title))).length;
      const commTitlesFound = top3ByCommInTop20.filter((p) => output.includes(snippet(p.title))).length;
      const totalTitlesNeeded = 6;
      const titlesFound = scoreTitlesFound + commTitlesFound;

      const callsRecall = toolCalls.some((c) => c.name === "recall");

      const formatAdherence =
        hasScoreSection && hasCommentsSection ? 1 : hasScoreSection || hasCommentsSection ? 0.5 : 0;
      const completeness = Math.min(1, titlesFound / totalTitlesNeeded);

      return buildQuality({
        toolSuccess: toolCalls.some((c) => c.name === "get-hn-posts"),
        formatAdherence,
        faithfulness: titlesFound / totalTitlesNeeded,
        completeness,
        noFabrication: 1, // hard to detect fabrication here without per-line check
        callsRecall,
        notes: [
          hasScoreSection ? "Highest Score section ✓" : "★ missing Highest Score section",
          hasCommentsSection ? "Most Comments section ✓" : "★ missing Most Comments section",
          `${titlesFound}/${totalTitlesNeeded} correct titles`,
          callsRecall ? "★ called recall()" : "",
        ].filter((n) => n.length > 0),
      });
    },
  },

  // T5 — long-form synthesis (the broadest pattern, scratch.ts equivalent)
  {
    id: "T5-long-form-synthesis",
    description:
      "Fetch top 15 HN posts and write a paragraph-style summary categorizing them by topic. Tests substantive synthesis from observation data.",
    tools: [hnTool],
    task:
      "Fetch the top 15 Hacker News posts. Then write a markdown report titled '# Today on Hacker News' that summarizes the top stories grouped into 2-4 thematic categories (e.g. 'AI/ML', 'Hardware', 'Programming', 'Other'). Each category should have a short paragraph mentioning specific story titles from the tool result. Length: 200-500 words.",
    score: (output, toolCalls) => {
      const wordCount = output.split(/\s+/).filter((w) => w.length > 0).length;
      const hasTitle = /^#\s+Today on Hacker News/im.test(output);
      const top15 = HN_CACHE.slice(0, 15);
      const titlesFound = top15.filter((p) => output.includes(snippet(p.title, 25))).length;

      // Detect echoed tool-preview garbage
      const isToolPreviewEcho =
        output.includes("[recall result") ||
        output.includes("compressed preview") ||
        output.includes("_tool_result_");

      const callsRecall = toolCalls.some((c) => c.name === "recall");
      const headerCount = (output.match(/^##\s+/gm) ?? []).length;

      const formatAdherence = hasTitle && headerCount >= 2 ? 1.0 : hasTitle ? 0.5 : 0.2;
      const completeness =
        wordCount >= 200 && wordCount <= 600 ? 1.0 : wordCount >= 100 ? 0.5 : 0.2;

      return buildQuality({
        toolSuccess: toolCalls.some((c) => c.name === "get-hn-posts"),
        formatAdherence,
        faithfulness: titlesFound / 15,
        completeness,
        noFabrication: isToolPreviewEcho ? 0 : 1,
        callsRecall,
        notes: [
          hasTitle ? "title ✓" : "★ missing title",
          `${headerCount} category sections`,
          `${titlesFound}/15 titles cited`,
          `${wordCount} words`,
          isToolPreviewEcho ? "★ tool-preview echoed" : "",
          callsRecall ? "★ called recall()" : "",
        ].filter((n) => n.length > 0),
      });
    },
  },
];

// ── Runner ──────────────────────────────────────────────────────────────────
async function runTask(task: TaskDef, runIndex: number): Promise<TaskResult> {
  const runLabel = RUNS_PER_TASK > 1 ? ` [run ${runIndex + 1}/${RUNS_PER_TASK}]` : "";
  console.log(`\n${"=".repeat(72)}`);
  console.log(`[${task.id}]${runLabel} ${task.description}`);
  console.log("=".repeat(72));

  const builder = ReactiveAgents.create()
    .withName(`task-gate-${task.id}`)
    .withProvider(PROVIDER as never)
    .withModel(MODEL);

  // TASK_GATE_NO_MEMORY=1 disables memory — which ALSO disables debrief synthesis
  // (debrief only fires on the memory-enabled path). Used to attribute the
  // tokensUsed − (in+out) auxiliary-call gap (Inc 2 confirmation).
  if (process.env.TASK_GATE_NO_MEMORY !== "1") {
    builder.withMemory();
  }
  builder.withReasoning();

  // Opt in to model calibration loading. Set TASK_GATE_CALIBRATION=skip to
  // disable for control-arm probes.
  if (process.env.TASK_GATE_CALIBRATION !== "skip") {
    (builder as any).withCalibration("auto");
  }

  if (task.tools.length > 0) {
    builder.withTools({ tools: task.tools });
  }
  if (RECENT_OBS_LIMIT > 0) {
    builder.withContextProfile({ recentObservationsLimit: RECENT_OBS_LIMIT });
  }

  const agent = await builder.build();
  const start = performance.now();
  const result = await agent.run(task.task);
  const wallMs = performance.now() - start;
  const output = String(result.output ?? "");
  const tokensUsed = (result.metadata?.tokensUsed as number | undefined) ?? 0;
  const inputTokens = (result.metadata?.inputTokens as number | undefined) ?? 0;
  const outputTokens = (result.metadata?.outputTokens as number | undefined) ?? 0;
  const stepsCount = (result.metadata?.stepsCount as number | undefined) ?? 0;

  // Tool calls now derived in builder.ts and exposed at result.metadata.toolCalls.
  // Falls back to scanning result.metadata.reasoningSteps for older runs.
  const md = result.metadata as {
    toolCalls?: ReadonlyArray<{ name: string }>;
    reasoningSteps?: ReadonlyArray<{ type: string; metadata?: Record<string, unknown> }>;
  };
  const toolCalls: Array<{ name: string }> = md.toolCalls
    ? md.toolCalls.map((c) => ({ name: c.name }))
    : (md.reasoningSteps ?? [])
        .filter((s) => s.type === "action")
        .map((s) => (s.metadata?.toolCall as { name?: string } | undefined)?.name)
        .filter((n): n is string => !!n)
        .map((name) => ({ name }));

  const quality = task.score(output, toolCalls);

  console.log(`Output (${output.length} chars):`);
  console.log(output.slice(0, 600));
  if (output.length > 600) console.log(`...(truncated)`);
  console.log(`\nQuality:`);
  console.log(`  composite:      ${(quality.composite * 100).toFixed(0)}%`);
  console.log(`  faithfulness:   ${(quality.faithfulness * 100).toFixed(0)}%`);
  console.log(`  format:         ${(quality.formatAdherence * 100).toFixed(0)}%`);
  console.log(`  completeness:   ${(quality.completeness * 100).toFixed(0)}%`);
  console.log(`  no-fabrication: ${(quality.noFabrication * 100).toFixed(0)}%`);
  console.log(`  callsRecall:    ${quality.callsRecall ? "YES (smell)" : "no"}`);
  if (quality.strictCorrect !== undefined) {
    console.log(`  strictCorrect:  ${quality.strictCorrect ? "YES ✓" : "NO ✗"} (T3 exact top-3 ids)`);
  }
  console.log(`Notes: ${quality.notes.join("; ")}`);
  console.log(`Wall: ${(wallMs / 1000).toFixed(1)}s | Tokens: ${tokensUsed} (in:${inputTokens} out:${outputTokens}) | Steps: ${stepsCount}`);

  return {
    taskId: task.id,
    taskDescription: task.description,
    success: result.success,
    tokensUsed,
    inputTokens,
    outputTokens,
    stepsCount,
    toolCallCount: toolCalls.length,
    wallMs,
    output,
    quality,
    runIndex,
    postConditionsMet: null, // Phase 1 stub
  };
}

// ── Aggregate N runs into a TaskRunSet ───────────────────────────────────────
function aggregateRuns(task: TaskDef, runs: readonly TaskResult[]): TaskRunSet {
  const successCount = runs.filter((r) => r.success).length;
  const passK = successCount === runs.length;
  const passKLabel = `${successCount}/${runs.length}`;

  const composites = runs.map((r) => r.quality.composite);
  const compositeMin = composites.length ? Math.min(...composites) : 0;
  const compositeMax = composites.length ? Math.max(...composites) : 0;
  const compositeMean = composites.length ? composites.reduce((s, v) => s + v, 0) / composites.length : 0;
  const compositeSpread = compositeMax - compositeMin;

  let t3StrictCorrectCount: number | null = null;
  let t3StrictCorrectLabel: string | null = null;
  if (task.id === "T3-selective-filter") {
    t3StrictCorrectCount = runs.filter((r) => r.quality.strictCorrect === true).length;
    t3StrictCorrectLabel = `${t3StrictCorrectCount}/${runs.length}`;
  }

  return {
    taskId: task.id,
    taskDescription: task.description,
    runs,
    passK,
    passKLabel,
    compositeMean,
    compositeMin,
    compositeMax,
    compositeSpread,
    t3StrictCorrectCount,
    t3StrictCorrectLabel,
    postConditionsMet: null, // Phase 1 stub
  };
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  console.log(
    `\nTask Quality Gate — ${MODEL} via ${PROVIDER} | recentObservationsLimit=${RECENT_OBS_LIMIT} | runsPerTask=${RUNS_PER_TASK}\n`,
  );

  const runSets: TaskRunSet[] = [];

  for (const task of TASKS) {
    const runs: TaskResult[] = [];
    for (let i = 0; i < RUNS_PER_TASK; i++) {
      const r = await runTask(task, i);
      runs.push(r);
    }
    runSets.push(aggregateRuns(task, runs));
  }

  // Summary table
  const tableWidth = 120;
  console.log(`\n${"=".repeat(tableWidth)}`);
  console.log("TASK QUALITY GATE SUMMARY");
  console.log(`Model: ${MODEL} | Provider: ${PROVIDER} | Runs/task: ${RUNS_PER_TASK}`);
  console.log("=".repeat(tableWidth));

  // Header
  console.log(
    [
      "task".padEnd(30),
      "pass^k".padEnd(7),
      "composite(runs)".padEnd(22),
      "faith".padEnd(6),
      "format".padEnd(7),
      "compl".padEnd(6),
      "no-fabr".padEnd(8),
      "T3-strict".padEnd(10),
      "postCond".padEnd(9),
      "recall?",
    ].join(" | "),
  );
  console.log("-".repeat(tableWidth));

  for (const rs of runSets) {
    // Per-run composite scores as a string, e.g. "82%,75%,90%"
    const runComposites = rs.runs.map((r) => `${(r.quality.composite * 100).toFixed(0)}%`).join(",");
    const compositeCol = RUNS_PER_TASK > 1
      ? `${(rs.compositeMean * 100).toFixed(0)}% [${runComposites}]`
      : `${(rs.compositeMean * 100).toFixed(0)}%`;

    // Use last run's quality dimensions for the detail columns (representative)
    const lastRun = rs.runs[rs.runs.length - 1] as TaskResult;
    const recallCount = rs.runs.filter((r) => r.quality.callsRecall).length;
    const recallLabel = recallCount > 0 ? `YES(${recallCount}/${rs.runs.length})` : "no";

    console.log(
      [
        rs.taskId.padEnd(30),
        (rs.passK ? "✓ " : "✗ ") + rs.passKLabel.padEnd(4),
        compositeCol.padEnd(22),
        `${(lastRun.quality.faithfulness * 100).toFixed(0)}%`.padEnd(6),
        `${(lastRun.quality.formatAdherence * 100).toFixed(0)}%`.padEnd(7),
        `${(lastRun.quality.completeness * 100).toFixed(0)}%`.padEnd(6),
        `${(lastRun.quality.noFabrication * 100).toFixed(0)}%`.padEnd(8),
        (rs.t3StrictCorrectLabel ?? "—").padEnd(10),
        "—".padEnd(9),   // postConditionsMet stub
        recallLabel,
      ].join(" | "),
    );
  }

  // Variance / spread line
  console.log("-".repeat(tableWidth));
  if (RUNS_PER_TASK > 1) {
    console.log("VARIANCE (composite spread per task):");
    for (const rs of runSets) {
      const spread = (rs.compositeSpread * 100).toFixed(0);
      const min = (rs.compositeMin * 100).toFixed(0);
      const max = (rs.compositeMax * 100).toFixed(0);
      console.log(`  ${rs.taskId.padEnd(30)} min=${min}% max=${max}% spread=${spread}pp`);
    }
    console.log("-".repeat(tableWidth));
  }

  const allRuns = runSets.flatMap((rs) => rs.runs);
  const avgComposite = allRuns.length ? allRuns.reduce((s, r) => s + r.quality.composite, 0) / allRuns.length : 0;
  const recallSmellCount = allRuns.filter((r) => r.quality.callsRecall).length;
  const passKCount = runSets.filter((rs) => rs.passK).length;
  console.log(
    `pass^k tasks: ${passKCount}/${runSets.length} | avg composite: ${(avgComposite * 100).toFixed(0)}% | recall() smells: ${recallSmellCount}/${allRuns.length} runs`,
  );

  // Persist
  mkdirSync(REPORTS_DIR, { recursive: true });
  const reportPath = resolve(REPORTS_DIR, `task-quality-gate-${MODEL.replace(/[:.]/g, "-")}-${TIMESTAMP}.json`);
  writeFileSync(
    reportPath,
    JSON.stringify(
      {
        model: MODEL,
        provider: PROVIDER,
        recentObservationsLimit: RECENT_OBS_LIMIT,
        runsPerTask: RUNS_PER_TASK,
        timestamp: TIMESTAMP,
        runSets,
        // Legacy flat results for backward-compat readers (last run of each task)
        results: runSets.map((rs) => rs.runs[rs.runs.length - 1]),
        summary: {
          avgComposite,
          recallSmellCount,
          taskCount: runSets.length,
          totalRuns: allRuns.length,
          passKCount,
          passKRate: passKCount / runSets.length,
        },
      },
      null,
      2,
    ),
  );
  console.log(`\nReport written to ${reportPath}`);
}

main().catch((err) => {
  console.error("Task gate failed:", err);
  process.exit(1);
});
