// failure-corpus.ts — Generate a labeled success/failure trace corpus for AUC validation
// of the entropy signal.
//
// Usage:
//   bun run scripts/failure-corpus.ts
//
// After completion, run:
//   bun run scripts/validate-entropy.ts .reactive-agents/traces/failure-corpus
//
// Uses Ollama (local) — no API cost.

import { ReactiveAgents } from "reactive-agents";
import { loadTrace, traceStats } from "@reactive-agents/trace";
import { Effect } from "effect";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const CORPUS_MODEL = process.env.CORPUS_MODEL ?? "cogito:14b";
const TRACE_DIR = resolve(process.cwd(), ".reactive-agents/traces/failure-corpus");

// ── Tool factories ────────────────────────────────────────────────────────────

/** A tool that always fails with an Error — marks isError=true in the message history,
 *  which the tool-failure-streak evaluator counts for consecutive failure detection. */
function alwaysErrorTool(name: string, description: string, errorMsg: string) {
  return {
    definition: {
      name,
      description,
      parameters: [{ name: "input", type: "string" as const, description: "Query input", required: false }],
      riskLevel: "low" as const,
      timeoutMs: 3000,
      requiresApproval: false,
      source: "function" as const,
    },
    handler: (_args: Record<string, unknown>) =>
      Effect.die(new Error(errorMsg)),
  };
}

/** Two tools that return contradictory values for the same query. */
function contradictoryPairTools(entity: string) {
  return [
    {
      definition: {
        name: "source-alpha",
        description: `Fetch ${entity} data from Source Alpha (authoritative financial feed)`,
        parameters: [{ name: "query", type: "string" as const, description: "What to look up", required: true }],
        riskLevel: "low" as const,
        timeoutMs: 3000,
        requiresApproval: false,
        source: "function" as const,
      },
      handler: (_args: Record<string, unknown>) =>
        Effect.succeed({ source: "alpha", value: 1847.23, unit: "USD/oz", confidence: "high" } as unknown),
    },
    {
      definition: {
        name: "source-beta",
        description: `Fetch ${entity} data from Source Beta (cross-reference feed)`,
        parameters: [{ name: "query", type: "string" as const, description: "What to look up", required: true }],
        riskLevel: "low" as const,
        timeoutMs: 3000,
        requiresApproval: false,
        source: "function" as const,
      },
      handler: (_args: Record<string, unknown>) =>
        Effect.succeed({ source: "beta", value: 2341.88, unit: "USD/oz", confidence: "high" } as unknown),
    },
  ];
}

/** A working HN posts tool for success scenarios. */
function hnPostsTool() {
  return {
    definition: {
      name: "get-hn-posts",
      description: "Get current top Hacker News stories. Pass count to control how many.",
      parameters: [{ name: "count", type: "string" as const, description: "Number of posts to return (e.g. '5')", required: false }],
      riskLevel: "low" as const,
      timeoutMs: 10000,
      requiresApproval: false,
      source: "function" as const,
    },
    handler: (args: Record<string, unknown>) =>
      Effect.tryPromise({
        try: async () => {
          const n = Math.min(20, Math.max(1, Number(args.count) || 5));
          const ids = (await (await fetch("https://hacker-news.firebaseio.com/v0/topstories.json")).json()) as number[];
          const items = await Promise.all(
            ids.slice(0, n).map(async (id) => {
              const r = await fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`);
              return r.json() as Promise<{ title?: string; score?: number; url?: string }>;
            }),
          );
          return ids.slice(0, n).map((id, i) => ({
            id,
            title: items[i]?.title ?? "(no title)",
            score: items[i]?.score ?? 0,
            url: items[i]?.url ?? `https://news.ycombinator.com/item?id=${id}`,
          })) as unknown;
        },
        catch: (e) => (e instanceof Error ? e : new Error(String(e))),
      }).pipe(Effect.orDie),
  };
}

// ── Scenario runner ───────────────────────────────────────────────────────────

interface Scenario {
  id: string;
  label: "success" | "failure";
  task: string;
  maxIterations: number;
  expectation: string;
  tools: { definition: ReturnType<typeof alwaysErrorTool>["definition"]; handler: (args: Record<string, unknown>) => Effect.Effect<unknown, never> }[];
}

interface CorpusResult {
  taskId: string;
  scenarioId: string;
  label: "success" | "failure";
  success: boolean;
  maxEntropy: number;
  iterations: number | null;
  interventionsDispatched: number;
  interventionsSuppressed: number;
  durationMs: number;
  error: string | null;
}

const SCENARIOS: Scenario[] = [
  // ── Success: pure knowledge, no tools — always converges in ≤2 iterations ─
  // These give clean low-entropy convergence signals with zero tool ambiguity.
  {
    id: "success-days-of-week",
    label: "success",
    task: "List the 7 days of the week in order, starting with Monday.",
    maxIterations: 4,
    expectation: "Deterministic recall, 1 iteration, entropy ~0.150",
    tools: [],
  },
  {
    id: "success-capital-france",
    label: "success",
    task: "What is the capital city of France? Give just the city name.",
    maxIterations: 4,
    expectation: "Single-fact recall, 1 iteration, entropy ~0.150",
    tools: [],
  },
  {
    id: "success-rgb-colors",
    label: "success",
    task: "What are the three primary colors of light (RGB)? List them.",
    maxIterations: 4,
    expectation: "Single-fact recall, 1 iteration, entropy ~0.150",
    tools: [],
  },
  {
    id: "success-typescript-paradigm",
    label: "success",
    task: "What programming paradigm does TypeScript primarily support? List two features that reflect this.",
    maxIterations: 4,
    expectation: "Technical factual recall, 1-2 iterations, low entropy",
    tools: [],
  },

  // ── Failure: tools that always error — forces persistent retry loops ──────
  {
    id: "failure-rate-limit-loop",
    label: "failure",
    task: "Search the web for the current Bitcoin price. Rules: (1) You MUST use the web-search tool on EVERY attempt — never answer from memory. (2) If you get an error, wait and retry immediately. (3) You must call web-search at least 6 times before considering any other action. Do not call final-answer until web-search returns a price.",
    maxIterations: 12,
    expectation: "Tool always returns rate-limit error; explicit retry pressure forces 6+ tool calls, entropy accumulates",
    tools: [alwaysErrorTool("web-search", "Search the web for current information", "Rate limit exceeded. Quota resets in 60 seconds. Please retry.")],
  },
  {
    id: "failure-save-loop",
    label: "failure",
    task: "Save the audit record 'task=complete,status=verified,ts=now' using the save-data tool. Rules: (1) You MUST call save-data on every attempt. (2) On failure, retry immediately with the exact same data — do NOT modify it. (3) Call save-data at least 6 times. Only call final-answer after save-data returns {success: true}.",
    maxIterations: 12,
    expectation: "Save tool always fails; forced 6+ retry rule drives behavioral loop score above threshold",
    tools: [alwaysErrorTool("save-data", "Persist data to the database", '{"success": false, "error": "connection pool exhausted", "retryable": true}')],
  },
  {
    id: "failure-verify-loop",
    label: "failure",
    task: "Run the test suite using run-tests and keep fixing until all tests pass. Rules: (1) After each run-tests call, analyze the failures and call run-tests again. (2) You must call run-tests at least 6 times. (3) Do not give up or call final-answer until you see {failed: 0}.",
    maxIterations: 12,
    expectation: "Tests always fail; 6-call rule drives behavioral loop accumulation, strategy-switch fires",
    tools: [alwaysErrorTool("run-tests", "Execute the test suite and return pass/fail counts", '{"passed": 2, "failed": 3, "errors": ["assertion failed line 23", "null ref line 41", "type mismatch line 88"]}')],
  },
  {
    id: "failure-contradictory-data",
    label: "failure",
    task: "Use source-alpha and source-beta to determine the accurate current gold price. Rules: (1) Query BOTH sources on every attempt. (2) The sources must agree within $5 before you can report. (3) If they disagree, query both again — do not average or estimate. (4) Call both tools at least 4 times each.",
    maxIterations: 12,
    expectation: "Sources always disagree by $494; forced multi-call rule ensures behavioral loop score rises, multiple dispatches expected",
    tools: contradictoryPairTools("gold price"),
  },
];

async function runScenario(scenario: Scenario): Promise<CorpusResult> {
  console.log(`\n${"=".repeat(72)}`);
  console.log(`SCENARIO : ${scenario.id}  [${scenario.label.toUpperCase()}]`);
  console.log(`TASK     : ${scenario.task.slice(0, 80)}...`);
  console.log(`EXPECT   : ${scenario.expectation}`);
  console.log("=".repeat(72));

  const start = Date.now();

  try {
    const agent = await ReactiveAgents.create()
      .withProvider("ollama")
      .withModel({ model: CORPUS_MODEL })
      .withReasoning({ defaultStrategy: "reactive", maxIterations: scenario.maxIterations })
      .withReactiveIntelligence()
      .withTools({ tools: scenario.tools })
      .withTracing({ dir: TRACE_DIR })
      .build();

    const result = await agent.run(scenario.task);
    const durationMs = Date.now() - start;
    await agent.dispose();

    // Load trace for detailed stats
    let maxEntropy = 0;
    let iterations: number | null = null;
    let interventionsDispatched = 0;
    let interventionsSuppressed = 0;

    try {
      const trace = await loadTrace(`${TRACE_DIR}/${result.taskId}.jsonl`);
      const s = traceStats(trace);
      maxEntropy = s.maxEntropy;
      iterations = s.iterations;
      interventionsDispatched = s.interventionsDispatched;
      interventionsSuppressed = s.interventionsSuppressed;
    } catch {
      iterations = result.metadata?.stepsCount ?? null;
    }

    const corpusResult: CorpusResult = {
      taskId: result.taskId,
      scenarioId: scenario.id,
      label: scenario.label,
      success: result.success,
      maxEntropy,
      iterations,
      interventionsDispatched,
      interventionsSuppressed,
      durationMs,
      error: null,
    };

    console.log(`\n--- RESULT ---`);
    console.log(`Success:               ${corpusResult.success}`);
    console.log(`Iterations:            ${corpusResult.iterations} / ${scenario.maxIterations}`);
    console.log(`Max entropy:           ${corpusResult.maxEntropy.toFixed(3)}`);
    console.log(`Dispatched:            ${corpusResult.interventionsDispatched}  Suppressed: ${corpusResult.interventionsSuppressed}`);
    console.log(`Duration:              ${(durationMs / 1000).toFixed(1)}s`);
    console.log(`Trace:                 ${TRACE_DIR}/${result.taskId}.jsonl`);

    return corpusResult;
  } catch (err) {
    const durationMs = Date.now() - start;
    const message = err instanceof Error ? err.message : String(err);
    console.error(`\nScenario ${scenario.id} threw an error: ${message}`);

    return {
      taskId: `${scenario.id}-error`,
      scenarioId: scenario.id,
      label: scenario.label,
      success: false,
      maxEntropy: 0,
      iterations: null,
      interventionsDispatched: 0,
      interventionsSuppressed: 0,
      durationMs,
      error: message,
    };
  }
}

function printSummaryTable(results: CorpusResult[]): void {
  console.log("\n");
  console.log("=".repeat(90));
  console.log("FAILURE CORPUS SUMMARY");
  console.log("=".repeat(90));

  const header = [
    "scenarioId".padEnd(30),
    "label".padEnd(9),
    "success".padEnd(9),
    "maxEntropy".padEnd(12),
    "iters".padEnd(7),
    "dispatch".padEnd(10),
    "suppressed",
  ].join(" | ");
  console.log(header);
  console.log("-".repeat(95));

  for (const r of results) {
    const row = [
      r.scenarioId.padEnd(30),
      r.label.padEnd(9),
      String(r.success).padEnd(9),
      r.maxEntropy.toFixed(3).padEnd(12),
      String(r.iterations ?? "?").padEnd(7),
      String(r.interventionsDispatched).padEnd(10),
      String(r.interventionsSuppressed),
    ].join(" | ");
    console.log(row);
  }

  console.log("=".repeat(90));

  const successCount = results.filter((r) => r.success).length;
  const failureCount = results.length - successCount;
  const labeledSuccess = results.filter((r) => r.label === "success").length;
  const labeledFailure = results.filter((r) => r.label === "failure").length;
  const avgEntropySuccess = results
    .filter((r) => r.label === "success")
    .reduce((acc, r) => acc + r.maxEntropy, 0) / Math.max(1, labeledSuccess);
  const avgEntropyFailure = results
    .filter((r) => r.label === "failure")
    .reduce((acc, r) => acc + r.maxEntropy, 0) / Math.max(1, labeledFailure);

  console.log(`\nRuns: ${results.length} total (${labeledSuccess} success scenarios, ${labeledFailure} failure scenarios)`);
  console.log(`Completed successfully: ${successCount} | Completed as failure/error: ${failureCount}`);
  console.log(`Avg maxEntropy (success scenarios): ${avgEntropySuccess.toFixed(3)}`);
  console.log(`Avg maxEntropy (failure scenarios): ${avgEntropyFailure.toFixed(3)}`);
  console.log(
    `\nEntropy discrimination gap: ${(avgEntropyFailure - avgEntropySuccess).toFixed(3)}` +
      ` (positive = entropy is higher on failure runs, as expected)`
  );

  console.log(`\nNext step:`);
  console.log(`  bun run scripts/validate-entropy.ts .reactive-agents/traces/failure-corpus`);
  console.log(`  (AUC > 0.7 = signal is real; ~0.5 = noise; < 0.5 = inverted)`);
}

async function main(): Promise<void> {
  mkdirSync(TRACE_DIR, { recursive: true });

  console.log(`Failure Corpus Runner`);
  console.log(`Model:     ${CORPUS_MODEL}`);
  console.log(`Trace dir: ${TRACE_DIR}`);
  console.log(`Scenarios: ${SCENARIOS.length} (${SCENARIOS.filter((s) => s.label === "success").length} success, ${SCENARIOS.filter((s) => s.label === "failure").length} failure)`);

  const results: CorpusResult[] = [];

  // Load existing labels so accumulation across runs stays consistent
  const labelFile = `${TRACE_DIR}/corpus-labels.json`;
  const existingLabels: Record<string, "success" | "failure"> = existsSync(labelFile)
    ? JSON.parse(readFileSync(labelFile, "utf8"))
    : {};

  for (const scenario of SCENARIOS) {
    const result = await runScenario(scenario);
    results.push(result);
    // Record corpus label keyed by taskId so validate-entropy.ts can use it
    if (result.taskId && !result.taskId.endsWith("-error")) {
      existingLabels[result.taskId] = result.label;
      writeFileSync(labelFile, JSON.stringify(existingLabels, null, 2));
    }
  }

  printSummaryTable(results);
}

main().catch(console.error);
