// harness-probe.ts — Reactive Agents harness improvement loop probe runner
// Copy to scripts/harness-probe.ts in your project root, then:
//   bun run scripts/harness-probe.ts 2>&1 | tee harness-reports/probe-run-$(date +%Y%m%d-%H%M).txt
//
// Uses Ollama (local) by default — no API cost. Swap PROBE_MODEL for any model
// available on your Ollama instance. Use a 7B–14B model; smaller models produce
// noisy quality scores that make analysis harder than it's worth.
//
// Override model at runtime:
//   PROBE_MODEL=cogito:8b bun run scripts/harness-probe.ts

import { ReactiveAgents } from "@reactive-agents/runtime";
import { writeFileSync, mkdirSync, readFileSync } from "fs";

const PROBE_MODEL = "qwen2.5:7b";

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
  qualityScore: number | null;
  contextPeakRatio: number | null;
  duplicateToolCalls: number;
  wastedIterations: number;
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
    .withModel({ model: process.env.PROBE_MODEL ?? PROBE_MODEL })
    .withReasoning({
      defaultStrategy: probe.strategy as any,
      maxIterations: probe.maxIterations,
    })
    .withTools({ allowedTools: ["web-search", "http-get", "checkpoint", "final-answer"] })
    .withObservability({
      verbosity: "debug",
      live: true,
      logModelIO: true,
      file: `./harness-reports/probe-${probe.id}.jsonl`,
    })
    .build();

  const start = Date.now();
  const result = await agent.run(probe.task);
  const durationMs = Date.now() - start;

  await agent.dispose();

  const metrics = extractMetricsFromJsonl(`./harness-reports/probe-${probe.id}.jsonl`);

  const probeResult: ProbeResult = {
    id: probe.id,
    strategy: probe.strategy,
    maxIterationsAllowed: probe.maxIterations,
    iterationsUsed: result.metadata.stepsCount ?? metrics.iterations,
    success: result.success,
    outputLength: result.output.length,
    durationMs,
    costUsd: result.metadata.cost,
    qualityScore: metrics.finalQualityScore,
    contextPeakRatio: metrics.contextPeakRatio,
    duplicateToolCalls: metrics.duplicateToolCalls,
    wastedIterations: metrics.wastedIterations,
    outputPreview: result.output.slice(0, 400),
  };

  console.log(`\n--- RESULT ---`);
  console.log(`Success:          ${probeResult.success}`);
  console.log(`Iterations:       ${probeResult.iterationsUsed} / ${probe.maxIterations}`);
  console.log(`Wasted iters:     ${probeResult.wastedIterations}`);
  console.log(`Duplicate calls:  ${probeResult.duplicateToolCalls}`);
  console.log(
    `Context peak:     ${probeResult.contextPeakRatio != null ? (probeResult.contextPeakRatio * 100).toFixed(1) + "%" : "?"}`,
  );
  console.log(`Quality score:    ${probeResult.qualityScore ?? "?"}`);
  console.log(`Duration:         ${(durationMs / 1000).toFixed(1)}s`);
  console.log(`Cost:             $${probeResult.costUsd.toFixed(4)}`);
  console.log(`\nOutput preview:\n${probeResult.outputPreview}`);

  return probeResult;
}

function extractMetricsFromJsonl(path: string): {
  iterations: number | null;
  finalQualityScore: number | null;
  contextPeakRatio: number | null;
  duplicateToolCalls: number;
  wastedIterations: number;
} {
  try {
    const lines = readFileSync(path, "utf-8").trim().split("\n").filter(Boolean);
    const events = lines.map((l) => JSON.parse(l) as Record<string, unknown>);

    const qualityEvents = events.filter((e) => e.qualityScore != null);
    const finalQualityScore = (qualityEvents.at(-1)?.qualityScore as number | undefined) ?? null;

    const contextRatios = events
      .filter((e) => e.contextRatio != null)
      .map((e) => e.contextRatio as number);
    const contextPeakRatio = contextRatios.length > 0 ? Math.max(...contextRatios) : null;

    const iterations = events.filter((e) => e.event === "ThinkStart" || e.phase === "think").length || null;

    const toolCallKeys = events
      .filter((e) => e.event === "ToolCallStart")
      .map((e) => `${e.toolName}::${JSON.stringify(e.args)}`);
    const seen = new Set<string>();
    let duplicateToolCalls = 0;
    for (const key of toolCallKeys) {
      if (seen.has(key)) duplicateToolCalls++;
      seen.add(key);
    }

    // Wasted: think event immediately followed by another think (no tool call or answer in between)
    let wastedIterations = 0;
    for (let i = 0; i < events.length - 1; i++) {
      const curr = events[i];
      const next = events[i + 1];
      if (
        (curr.event === "ThinkStart" || curr.phase === "think") &&
        (next.event === "ThinkStart" || next.phase === "think")
      ) {
        wastedIterations++;
      }
    }

    return { iterations, finalQualityScore, contextPeakRatio, duplicateToolCalls, wastedIterations };
  } catch {
    return {
      iterations: null,
      finalQualityScore: null,
      contextPeakRatio: null,
      duplicateToolCalls: 0,
      wastedIterations: 0,
    };
  }
}

async function main() {
  mkdirSync("harness-reports", { recursive: true });

  const results: ProbeResult[] = [];
  for (const probe of PROBES) {
    const result = await runProbe(probe);
    results.push(result);
  }

  writeFileSync(
    `harness-reports/probe-summary-${new Date().toISOString().slice(0, 16).replace("T", "-")}.json`,
    JSON.stringify(results, null, 2),
  );

  console.log("\n✅ All probes complete.");
  console.log("   JSONL logs: harness-reports/probe-{id}.jsonl");
  console.log("   Summary:    harness-reports/probe-summary-*.json");
  console.log("   Fill in:    harness-reports/improvement-report-*.md");
}

main().catch(console.error);
