// harness-probe.ts — Reactive Agents harness improvement loop probe runner
// Run from project root:
//   bun run .agents/skills/harness-improvement-loop/scripts/harness-probe.ts
//
// Uses Ollama (local) by default — no API cost. Swap PROBE_MODEL for any model
// available on your Ollama instance. Use a 7B–14B model; smaller models produce
// noisy entropy scores that make analysis harder than it's worth.
//
// Override model at runtime:
//   PROBE_MODEL=cogito:8b bun run .agents/skills/harness-improvement-loop/scripts/harness-probe.ts

import { ReactiveAgents } from "@reactive-agents/runtime";
import { loadTrace, traceStats } from "@reactive-agents/trace";
import { writeFileSync, mkdirSync } from "fs";

const PROBE_MODEL = process.env.PROBE_MODEL ?? "cogito:8b";
const TRACE_DIR = ".reactive-agents/traces";

interface ProbeConfig {
  id: string;
  strategy: string;
  maxIterations: number;
  task: string;
  expectation: string;
}

interface ProbeResult {
  id: string;
  strategy: string;
  maxIterationsAllowed: number;
  iterationsUsed: number | null;
  success: boolean;
  outputLength: number;
  durationMs: number;
  costUsd: number;
  maxEntropy: number | null;
  interventionsDispatched: number;
  interventionsSuppressed: number;
  totalTokens: number;
  outputPreview: string;
}

// Pass focus: memory utilization. trivial-1step retained as regression baseline
// (loop-state::regressionBaselines asserts iterations=1, actPhaseCount=0).
// Memory probes target: (a) scratchpad→final-answer fidelity, (b) recall
// invocation rate when preview truncates real data, (c) semantic memory auto-
// population, (d) context pressure degradation on multi-observation runs.
// Originals preserved in git history; restore before the next non-memory pass.
const PROBES: ProbeConfig[] = [
  {
    id: "trivial-1step",
    strategy: "reactive",
    maxIterations: 5,
    task: "What is 12 × 15?",
    expectation: "1 iteration, no tool calls, immediate final-answer",
  },
  {
    id: "memory-retrieval-fidelity",
    strategy: "reactive",
    maxIterations: 8,
    task:
      "Use web-search to look up 'top programming languages 2024'. Then list EXACTLY 10 programming languages from the results in your final answer. Each entry must include the language name and one distinguishing feature that appeared in the search results. Do not invent entries — only use what the search returned.",
    expectation:
      "1–2 web-search calls; final answer cites only items present in tool observations; no hallucinated language names; if preview truncates results, agent calls recall or find to get full data",
  },
  {
    id: "memory-recall-invocation",
    strategy: "reactive",
    maxIterations: 8,
    task:
      "Use web-search with the query 'popular javascript frameworks' to get results. Then answer: what was the 7th search result? Give its exact title and URL. If you cannot see it in the compressed preview, use recall to fetch the full stored tool result.",
    expectation:
      "Exactly 1 web-search call; at least 1 recall call with a _tool_result_N key; final answer cites the 7th result accurately",
  },
  {
    id: "memory-multi-observation-synthesis",
    strategy: "plan-execute-reflect",
    maxIterations: 12,
    task:
      "Search for each of these in turn: 'Rust memory safety', 'Go concurrency model', 'Python type hints'. After all 3 searches, produce a 3-paragraph synthesis — one paragraph per topic — drawing only on facts returned by the searches. Each paragraph must cite at least one specific result from that topic's search.",
    expectation:
      "3 distinct web-search calls; synthesis references observations from all 3 (not just the most recent); no conflation between topics; auto-checkpoint or find may fire as context grows",
  },
  {
    id: "memory-context-pressure-degradation",
    strategy: "plan-execute-reflect",
    maxIterations: 15,
    task:
      "Research the history of functional programming languages from LISP to today. Cover at least 8 languages with dates and key innovations for each. Use at least 3 web-search calls to gather material before synthesizing.",
    expectation:
      "Multiple searches, auto-checkpoint fires at least once, final output coherently covers 8+ languages with correct dates drawn from tool observations",
  },
];

async function runProbe(probe: ProbeConfig): Promise<ProbeResult> {
  console.log(`\n${"=".repeat(70)}`);
  console.log(`PROBE: ${probe.id} | strategy: ${probe.strategy} | maxIter: ${probe.maxIterations}`);
  console.log(`TASK:   ${probe.task}`);
  console.log(`EXPECT: ${probe.expectation}`);
  console.log("=".repeat(70));

  const agent = await ReactiveAgents.create()
    .withProvider("ollama")
    .withModel({ model: PROBE_MODEL })
    .withReasoning({
      defaultStrategy: probe.strategy as any,
      maxIterations: probe.maxIterations,
    })
    .withReactiveIntelligence()
    .withTools({
      // Memory probes need recall/find to be callable; earlier probe builds
      // omitted them and the filter layer silently rejected the agent's calls.
      allowedTools: [
        "web-search", "http-get", "checkpoint", "final-answer",
        "recall", "find", "brief", "pulse",
      ],
    })
    .withTracing({ dir: TRACE_DIR })
    .build();

  const start = Date.now();
  const result = await agent.run(probe.task);
  const durationMs = Date.now() - start;
  await agent.dispose();

  // Load typed trace for this run
  let stats = { iterations: null as number | null, maxEntropy: 0, interventionsDispatched: 0, interventionsSuppressed: 0, totalTokens: 0 };
  try {
    const trace = await loadTrace(`${TRACE_DIR}/${result.taskId}.jsonl`);
    const s = traceStats(trace);
    stats = {
      iterations: s.iterations,
      maxEntropy: s.maxEntropy,
      interventionsDispatched: s.interventionsDispatched,
      interventionsSuppressed: s.interventionsSuppressed,
      totalTokens: s.totalTokens,
    };
  } catch {
    // trace not available (e.g. tracing not wired yet) — fall back to result metadata
    stats.iterations = result.metadata?.stepsCount ?? null;
    stats.totalTokens = result.metadata?.totalTokens ?? 0;
  }

  const probeResult: ProbeResult = {
    id: probe.id,
    strategy: probe.strategy,
    maxIterationsAllowed: probe.maxIterations,
    iterationsUsed: stats.iterations,
    success: result.success,
    outputLength: result.output.length,
    durationMs,
    costUsd: result.metadata?.cost ?? 0,
    maxEntropy: stats.maxEntropy,
    interventionsDispatched: stats.interventionsDispatched,
    interventionsSuppressed: stats.interventionsSuppressed,
    totalTokens: stats.totalTokens,
    outputPreview: result.output.slice(0, 400),
  };

  console.log(`\n--- RESULT ---`);
  console.log(`Success:              ${probeResult.success}`);
  console.log(`Iterations:           ${probeResult.iterationsUsed} / ${probe.maxIterations}`);
  console.log(`Max entropy:          ${probeResult.maxEntropy?.toFixed(3) ?? "?"}`);
  console.log(`Interventions:        ${probeResult.interventionsDispatched} dispatched, ${probeResult.interventionsSuppressed} suppressed`);
  console.log(`Tokens:               ${probeResult.totalTokens}`);
  console.log(`Duration:             ${(durationMs / 1000).toFixed(1)}s`);
  console.log(`Cost:                 $${probeResult.costUsd.toFixed(4)}`);
  console.log(`\nOutput preview:\n${probeResult.outputPreview}`);
  console.log(`\nTrace: ${TRACE_DIR}/${result.taskId}.jsonl`);
  console.log(`Inspect: rax trace inspect ${TRACE_DIR}/${result.taskId}.jsonl`);

  return probeResult;
}

async function main() {
  mkdirSync("harness-reports", { recursive: true });
  mkdirSync(TRACE_DIR, { recursive: true });

  // Optional single-probe filter: `bun run harness-probe.ts <probe-id>`
  const targetId = process.argv[2];
  const toRun = targetId ? PROBES.filter((p) => p.id === targetId) : PROBES;
  if (targetId && toRun.length === 0) {
    console.error(`No probe matches id "${targetId}". Available:`, PROBES.map((p) => p.id).join(", "));
    process.exit(1);
  }

  const results: ProbeResult[] = [];
  for (const probe of toRun) {
    const result = await runProbe(probe);
    results.push(result);
  }

  const summaryPath = `harness-reports/probe-summary-${new Date().toISOString().slice(0, 16).replace("T", "-")}.json`;
  writeFileSync(summaryPath, JSON.stringify(results, null, 2));

  console.log("\n✅ All probes complete.");
  console.log(`   Traces:   ${TRACE_DIR}/<runId>.jsonl`);
  console.log(`   Summary:  ${summaryPath}`);
  console.log(`   Analyze:  bun run scripts/validate-entropy.ts ${TRACE_DIR}`);
  console.log(`   Reports:  harness-reports/improvement-report-*.md`);
}

main().catch(console.error);
