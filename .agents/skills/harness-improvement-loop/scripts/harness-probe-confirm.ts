// harness-probe-confirm.ts — Pass 2 confirmation probes
// Targets W1 (cogito text-format FC), W2 (ICS masks loop detector), W4 (maxIterations wiring)
//
//   bun run scripts/harness-probe-confirm.ts 2>&1 | tee harness-reports/probe-confirm-$(date +%Y%m%d-%H%M).txt

import { ReactiveAgents } from "@reactive-agents/runtime";
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "fs";

const COGITO_MODEL = "cogito:8b";
const REPORT_DIR = "./harness-reports";

interface ConfirmProbeConfig {
  id: string;
  hypothesis: string; // Which weakness this confirms
  description: string;
  strategy: string;
  maxIterations: number;
  useWithMaxIterations?: boolean; // true = use .withMaxIterations(), false = use .withReasoning({ maxIterations })
  requiredTools?: string[];
  allowedTools: string[];
  task: string;
  passCriteria: string;
}

interface ConfirmResult {
  id: string;
  hypothesis: string;
  iterationsUsed: number | null;
  maxIterationsConfigured: number;
  iterationBuilderMethod: string;
  actPhaseCount: number;
  loopDetectorFired: boolean;
  strategySwitch: boolean;
  success: boolean;
  qualityScore: number | null;
  durationMs: number;
  passed: boolean;
  notes: string;
}

const CONFIRM_PROBES: ConfirmProbeConfig[] = [
  // ── W1: cogito:8b text-format tool call (not native FC) ──────────────────
  {
    id: "w1-cogito-fc-basic",
    hypothesis: "W1",
    description: "cogito:8b on a task requiring exactly one tool call — confirm zero act phases (text FC not parsed)",
    strategy: "reactive",
    maxIterations: 5,
    allowedTools: ["web-search"],
    task: "Use the web-search tool to find the current TypeScript version.",
    passCriteria: "actPhaseCount === 0 → confirms W1 (text-format FC not executed)",
  },
  {
    id: "w1-cogito-no-tools",
    hypothesis: "W1 control",
    description: "cogito:8b on pure-knowledge task with no tools — baseline: should succeed in 1 iter",
    strategy: "reactive",
    maxIterations: 5,
    allowedTools: [],
    task: "What is 7 × 9? Respond with just the number.",
    passCriteria: "iterationsUsed === 1, success === true → confirms cogito works fine without FC",
  },

  // ── W2: ICS nudge resets loop detector consecutive counter ───────────────
  {
    id: "w2-ics-required-tool",
    hypothesis: "W2",
    description: "cogito:8b + required tool web-search — ICS fires every iter, loop detector should never trip",
    strategy: "reactive",
    maxIterations: 8,
    requiredTools: ["web-search"],
    allowedTools: ["web-search"],
    task: "Use web-search to look up the definition of reactive programming.",
    passCriteria:
      "iterationsUsed >= 6 without loopDetectorFired → confirms W2 (ICS resets consecutive counter indefinitely)",
  },
  {
    id: "w2-no-ics-baseline",
    hypothesis: "W2 control",
    description: "cogito:8b + NO required tool — ICS absent, loop detector should fire by iter 3–4",
    strategy: "reactive",
    maxIterations: 8,
    allowedTools: [],
    task: "Search the internet for information about reactive programming. Keep searching until you have enough context.",
    passCriteria:
      "loopDetectorFired === true (or iterationsUsed <= 4) → baseline without ICS interference",
  },

  // ── W4: withReasoning({ maxIterations }) vs withMaxIterations() ──────────
  {
    id: "w4-reasoning-opt-maxiter",
    hypothesis: "W4",
    description: "withReasoning({ maxIterations: 3 }) — buggy path, maxIterations stored in _reasoningOptions only",
    strategy: "reactive",
    maxIterations: 3,
    useWithMaxIterations: false, // .withReasoning({ maxIterations: 3 }) — broken
    allowedTools: [],
    task: "Count from 1 to 100, thinking step by step. Show each number on its own line.",
    passCriteria:
      "iterationsUsed > 3 → confirms W4 (maxIterations from withReasoning() is ignored, default 10 used)",
  },
  {
    id: "w4-direct-maxiter",
    hypothesis: "W4 control",
    description: "withMaxIterations(3) — correct path, directly sets _maxIterations",
    strategy: "reactive",
    maxIterations: 3,
    useWithMaxIterations: true, // .withMaxIterations(3) — correct
    allowedTools: [],
    task: "Count from 1 to 100, thinking step by step. Show each number on its own line.",
    passCriteria:
      "iterationsUsed <= 3 → confirms withMaxIterations() correctly limits kernel iterations",
  },
];

async function runConfirmProbe(probe: ConfirmProbeConfig): Promise<ConfirmResult> {
  console.log(`\n${"=".repeat(72)}`);
  console.log(`CONFIRM PROBE: ${probe.id}`);
  console.log(`Hypothesis:   ${probe.hypothesis}`);
  console.log(`Description:  ${probe.description}`);
  console.log(`Pass when:    ${probe.passCriteria}`);
  console.log("=".repeat(72));

  const jsonlPath = `${REPORT_DIR}/probe-confirm-${probe.id}.jsonl`;

  let builder = ReactiveAgents.create()
    .withProvider("ollama")
    .withModel({ model: COGITO_MODEL });

  if (probe.useWithMaxIterations === true) {
    builder = builder.withMaxIterations(probe.maxIterations);
  } else {
    builder = (builder as any).withReasoning({
      defaultStrategy: probe.strategy as any,
      maxIterations: probe.maxIterations,
    });
  }

  if (probe.requiredTools && probe.requiredTools.length > 0) {
    builder = (builder as any).withTools({
      allowedTools: probe.allowedTools,
      requiredTools: probe.requiredTools,
    });
  } else {
    builder = (builder as any).withTools({ allowedTools: probe.allowedTools });
  }

  builder = (builder as any).withObservability({
    verbosity: "debug",
    live: true,
    logModelIO: false,
    file: jsonlPath,
  });

  const agent = await (builder as any).build();
  const start = Date.now();
  const result = await agent.run(probe.task);
  const durationMs = Date.now() - start;
  await agent.dispose();

  const metrics = parseMetricsFromJsonl(jsonlPath);

  const iterationsUsed =
    (result as any).metadata?.stepsCount ?? metrics.maxIteration;

  // Determine pass/fail based on hypothesis
  let passed = false;
  let notes = "";

  switch (probe.id) {
    case "w1-cogito-fc-basic":
      passed = metrics.actPhaseCount === 0;
      notes = `actPhaseCount=${metrics.actPhaseCount} (0 = W1 confirmed, >0 = W1 resolved)`;
      break;
    case "w1-cogito-no-tools":
      passed = (result as any).success === true && (iterationsUsed ?? 999) <= 2;
      notes = `success=${(result as any).success}, iter=${iterationsUsed}`;
      break;
    case "w2-ics-required-tool":
      passed = (iterationsUsed ?? 0) >= 6 && !metrics.loopDetectorFired;
      notes = `iter=${iterationsUsed}, loopFired=${metrics.loopDetectorFired} (≥6 iter + no loop = W2 confirmed)`;
      break;
    case "w2-no-ics-baseline":
      passed = metrics.loopDetectorFired || (iterationsUsed ?? 999) <= 4;
      notes = `iter=${iterationsUsed}, loopFired=${metrics.loopDetectorFired} (loop or early exit = healthy baseline)`;
      break;
    case "w4-reasoning-opt-maxiter":
      passed = (iterationsUsed ?? 0) > 3;
      notes = `iter=${iterationsUsed} (>3 = W4 confirmed: withReasoning maxIterations ignored)`;
      break;
    case "w4-direct-maxiter":
      passed = (iterationsUsed ?? 0) <= 3;
      notes = `iter=${iterationsUsed} (≤3 = correct: withMaxIterations() respected)`;
      break;
    default:
      passed = (result as any).success;
      notes = `success=${(result as any).success}`;
  }

  const confirmResult: ConfirmResult = {
    id: probe.id,
    hypothesis: probe.hypothesis,
    iterationsUsed,
    maxIterationsConfigured: probe.maxIterations,
    iterationBuilderMethod: probe.useWithMaxIterations
      ? "withMaxIterations()"
      : "withReasoning({ maxIterations })",
    actPhaseCount: metrics.actPhaseCount,
    loopDetectorFired: metrics.loopDetectorFired,
    strategySwitch: metrics.strategySwitch,
    success: (result as any).success,
    qualityScore: metrics.finalQualityScore,
    durationMs,
    passed,
    notes,
  };

  console.log(`\n--- RESULT ---`);
  console.log(`Passed:       ${passed ? "YES ✓" : "NO ✗"}`);
  console.log(`Notes:        ${notes}`);
  console.log(`Iterations:   ${iterationsUsed} / ${probe.maxIterations}`);
  console.log(`Act phases:   ${metrics.actPhaseCount}`);
  console.log(`Loop fired:   ${metrics.loopDetectorFired}`);
  console.log(`Strategy sw:  ${metrics.strategySwitch}`);
  console.log(`Quality:      ${metrics.finalQualityScore ?? "?"}`);
  console.log(`Duration:     ${(durationMs / 1000).toFixed(1)}s`);

  return confirmResult;
}

function parseMetricsFromJsonl(path: string): {
  maxIteration: number | null;
  finalQualityScore: number | null;
  actPhaseCount: number;
  loopDetectorFired: boolean;
  strategySwitch: boolean;
} {
  if (!existsSync(path)) {
    return {
      maxIteration: null,
      finalQualityScore: null,
      actPhaseCount: 0,
      loopDetectorFired: false,
      strategySwitch: false,
    };
  }
  try {
    const lines = readFileSync(path, "utf-8").trim().split("\n").filter(Boolean);
    const records = lines.map((l) => JSON.parse(l) as Record<string, unknown>);
    const metrics = records.filter((r) => r._type === "metric");

    // Max iteration number seen (execution.iteration gauge)
    const iterValues = metrics
      .filter((r) => r.name === "execution.iteration")
      .map((r) => r.value as number);
    const maxIteration = iterValues.length > 0 ? Math.max(...iterValues) : null;

    // Final quality (entropy.composite gauge — last value is most recent)
    const qualityValues = metrics.filter((r) => r.name === "entropy.composite");
    const finalQualityScore =
      qualityValues.length > 0 ? (qualityValues.at(-1)?.value as number) : null;

    // Act phase count (execution.phase.count with labels.phase === "act")
    const actPhaseCount = metrics
      .filter(
        (r) =>
          r.name === "execution.phase.count" &&
          (r as any).labels?.phase === "act",
      )
      .reduce((sum, r) => sum + (r.value as number), 0);

    // Loop detector fired: look for reasoning.loop metric or loop-related log entries
    const loopMetrics = metrics.filter(
      (r) =>
        (r.name as string | undefined)?.includes("loop") ||
        (r.name as string | undefined)?.includes("iteration.restart"),
    );
    const loopLogs = records.filter(
      (r) =>
        r._type === "log" &&
        (
          JSON.stringify(r).includes("loop") ||
          JSON.stringify(r).includes("Loop detected") ||
          JSON.stringify(r).includes("reasoning_loop") ||
          JSON.stringify(r).includes("strategy_switch")
        ),
    );
    const loopDetectorFired = loopMetrics.length > 0 || loopLogs.length > 0;

    // Strategy switch: look for strategy-switch metric or log
    const switchMetrics = metrics.filter(
      (r) => (r.name as string | undefined)?.includes("strategy"),
    );
    const switchLogs = records.filter(
      (r) =>
        r._type === "log" &&
        JSON.stringify(r).includes("strategy_switch"),
    );
    const strategySwitch = switchMetrics.length > 0 || switchLogs.length > 0;

    return { maxIteration, finalQualityScore, actPhaseCount, loopDetectorFired, strategySwitch };
  } catch {
    return {
      maxIteration: null,
      finalQualityScore: null,
      actPhaseCount: 0,
      loopDetectorFired: false,
      strategySwitch: false,
    };
  }
}

async function main() {
  mkdirSync(REPORT_DIR, { recursive: true });

  const results: ConfirmResult[] = [];
  for (const probe of CONFIRM_PROBES) {
    const r = await runConfirmProbe(probe);
    results.push(r);
  }

  const summaryPath = `${REPORT_DIR}/probe-confirm-summary-${new Date()
    .toISOString()
    .slice(0, 16)
    .replace("T", "-")}.json`;
  writeFileSync(summaryPath, JSON.stringify(results, null, 2));

  console.log(`\n${"=".repeat(72)}`);
  console.log("CONFIRMATION SUMMARY");
  console.log("=".repeat(72));
  for (const r of results) {
    const mark = r.passed ? "✓ PASS" : "✗ FAIL";
    console.log(`[${mark}] ${r.id.padEnd(32)} iter=${String(r.iterationsUsed ?? "?").padStart(3)}/${r.maxIterationsConfigured}  ${r.notes}`);
  }

  const passCount = results.filter((r) => r.passed).length;
  console.log(`\n${passCount}/${results.length} probes passed their pass criteria.`);
  console.log(`Summary: ${summaryPath}`);
}

main().catch(console.error);
