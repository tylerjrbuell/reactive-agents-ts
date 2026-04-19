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

const PROBES: ProbeConfig[] = [
  {
    id: "trivial-1step",
    strategy: "reactive",
    maxIterations: 5,
    task: "What is 12 × 15?",
    expectation: "1 iteration, no tool calls, immediate final-answer",
  },
  {
    id: "multistep-research",
    strategy: "plan-execute-reflect",
    maxIterations: 15,
    task: "Find 3 key differences between React Server Components and Client Components. Cite why each difference matters.",
    expectation: "Plans, searches once or twice, synthesizes with citations, terminates with reflect pass",
  },
  {
    id: "tool-heavy",
    strategy: "adaptive",
    maxIterations: 12,
    task: "Search for the latest TypeScript release notes and extract the 5 most impactful new features.",
    expectation: "1–2 web-search calls, no duplicate queries, clean extraction",
  },
  {
    id: "context-pressure",
    strategy: "plan-execute-reflect",
    maxIterations: 20,
    task: "Research the history of functional programming languages from LISP to today. Cover at least 8 languages with dates and key innovations for each.",
    expectation: "Auto-checkpoint fires before context limit. State is preserved. Output is coherent.",
  },
  {
    id: "termination-quality",
    strategy: "adaptive",
    maxIterations: 10,
    task: "Explain the CAP theorem and give a concrete real-world example of each of the three trade-offs.",
    expectation: "Early termination when quality gate passes. Does not exhaust maxIterations.",
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
    .withTools({ allowedTools: ["web-search", "http-get", "checkpoint", "final-answer"] })
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

  const results: ProbeResult[] = [];
  for (const probe of PROBES) {
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
