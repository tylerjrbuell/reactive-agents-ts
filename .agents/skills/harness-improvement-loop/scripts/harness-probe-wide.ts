// harness-probe-wide.ts — Pass 2 wide feature-sweep probes
// Uses qwen3:14b (native FC via <tools> XML template) to cover all major framework areas.
//
//   bun run scripts/harness-probe-wide.ts 2>&1 | tee harness-reports/probe-wide-$(date +%Y%m%d-%H%M).txt
//
// Override model:
//   WIDE_MODEL=qwen3:14b bun run scripts/harness-probe-wide.ts

import { ReactiveAgents } from "@reactive-agents/runtime";
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "fs";

const WIDE_MODEL = process.env.WIDE_MODEL ?? "qwen3:14b";
const REPORT_DIR = "./harness-reports";

// ─────────────────────────────────────────────────────────────────────────────
// Probe definitions
// ─────────────────────────────────────────────────────────────────────────────

interface WideProbeConfig {
  id: string;
  area: string; // Feature area under test
  strategy: string;
  maxIterations: number;
  useMaxIterationsDirect?: boolean;
  allowedTools: string[];
  requiredTools?: string[];
  task: string;
  expectation: string;
  passWhen: (r: WideMetrics) => boolean;
  passLabel: string;
}

interface WideMetrics {
  maxIteration: number | null;
  finalQualityScore: number | null;
  actPhaseCount: number;
  loopDetectorFired: boolean;
  strategySwitch: boolean;
  contextPeakRatio: number | null;
  success: boolean;
  outputLength: number;
  durationMs: number;
}

const WIDE_PROBES: WideProbeConfig[] = [
  // ── 1. Plan decomposition quality ────────────────────────────────────────
  {
    id: "plan-decomposition",
    area: "plan-execute-reflect: plan quality",
    strategy: "plan-execute-reflect",
    maxIterations: 12,
    allowedTools: [],
    task: [
      "Plan and execute the following task. Your plan MUST have at least 3 numbered steps.",
      "Task: Explain the three main types of database indexing strategies (B-tree, hash, and full-text),",
      "including when to use each and their performance trade-offs.",
    ].join(" "),
    expectation: "Produces a plan step, executes each step, reflects with synthesis. ≥3 steps seen in output.",
    passWhen: (r) => r.success && r.outputLength > 600 && (r.maxIteration ?? 0) >= 3,
    passLabel: "success + outputLength>600 + iter≥3",
  },

  // ── 2. Reflexion critique loop ────────────────────────────────────────────
  {
    id: "reflexion-critique",
    area: "reflexion: critique + improvement loop",
    strategy: "reflexion",
    maxIterations: 10,
    allowedTools: [],
    task: [
      "Answer the following question, then critique your own answer and improve it at least once.",
      "Question: What are the main trade-offs between eventual consistency and strong consistency in distributed systems?",
      "Show your initial answer, your critique, and your improved final answer.",
    ].join(" "),
    expectation: "Initial answer → self-critique → improved answer. Visible reflection in output.",
    passWhen: (r) => r.success && r.outputLength > 500,
    passLabel: "success + outputLength>500",
  },

  // ── 3. Adaptive routing: simple task → should use reactive ───────────────
  {
    id: "adaptive-simple-routes-reactive",
    area: "adaptive: strategy routing accuracy (simple → reactive)",
    strategy: "adaptive",
    maxIterations: 8,
    allowedTools: [],
    task: "What is the capital of France?",
    expectation: "Adaptive routes to reactive. Terminates in 1–2 iterations.",
    passWhen: (r) => r.success && (r.maxIteration ?? 0) <= 2,
    passLabel: "success + iter≤2",
  },

  // ── 4. Adaptive routing: complex task → should use plan-execute-reflect ──
  {
    id: "adaptive-complex-routes-plan",
    area: "adaptive: strategy routing accuracy (complex → plan)",
    strategy: "adaptive",
    maxIterations: 15,
    allowedTools: [],
    task: [
      "Research and explain the evolution of containerization technology from chroot in the 1970s to modern Kubernetes.",
      "Cover at least 5 major milestones with dates, explaining the technical problem each solved.",
    ].join(" "),
    expectation:
      "Adaptive routes to plan-execute-reflect (not reactive). Output is well-structured, ≥600 chars.",
    passWhen: (r) => r.success && r.outputLength > 600 && (r.maxIteration ?? 0) >= 3,
    passLabel: "success + outputLength>600 + iter≥3 (evidence of multi-step plan)",
  },

  // ── 5. Output format: explicit JSON request ───────────────────────────────
  {
    id: "output-format-json",
    area: "output synthesis: JSON format compliance",
    strategy: "reactive",
    maxIterations: 6,
    allowedTools: [],
    task: [
      'Respond ONLY with valid JSON matching this exact schema (no markdown, no prose outside the JSON):',
      '{"languages": [{"name": string, "year": number, "paradigm": string}]}',
      "Include exactly 3 programming languages: Python, Rust, and Haskell.",
    ].join(" "),
    expectation: "Output is parseable JSON matching the schema.",
    passWhen: (r) => {
      if (!r.success) return false;
      // Checked in main() after full output is available
      return true; // JSON parse check done post-hoc — flag outputLength as proxy
    },
    passLabel: "success (JSON parse checked post-run)",
  },

  // ── 6. Duplicate tool guard ───────────────────────────────────────────────
  {
    id: "duplicate-tool-guard",
    area: "guard: duplicate tool call prevention",
    strategy: "reactive",
    maxIterations: 8,
    allowedTools: ["web-search"],
    task: [
      'Search for "TypeScript generics tutorial" twice in a row to test duplicate detection.',
      "Make two web-search calls with identical arguments.",
    ].join(" "),
    expectation: "Guard blocks the second identical call. No duplicate executions in act phase.",
    passWhen: (r) => r.actPhaseCount <= 1,
    passLabel: "actPhaseCount≤1 (duplicate blocked by guard)",
  },

  // ── 7. Required tool: qwen3:14b can satisfy via native FC ─────────────────
  {
    id: "required-tools-satisfied",
    area: "ICS: required tools — success path with native FC",
    strategy: "reactive",
    maxIterations: 8,
    allowedTools: ["web-search"],
    requiredTools: ["web-search"],
    task: "Use web-search to find out what version of Node.js is current LTS.",
    expectation:
      "qwen3:14b calls web-search (native FC), ICS nudge NOT needed, completes successfully.",
    passWhen: (r) => r.success && r.actPhaseCount >= 1,
    passLabel: "success + actPhaseCount≥1 (required tool was called)",
  },

  // ── 8. Direct LLM path: no tools, single shot ─────────────────────────────
  {
    id: "direct-answer-efficiency",
    area: "reactive: direct answer efficiency (no tools needed)",
    strategy: "reactive",
    maxIterations: 5,
    allowedTools: [],
    task: "Explain in 2–3 sentences what a monad is in functional programming.",
    expectation:
      "Responds in 1 iteration. No wasted think steps. Output is concise (100–400 chars).",
    passWhen: (r) => r.success && (r.maxIteration ?? 0) <= 1 && r.outputLength > 50,
    passLabel: "success + iter≤1 + outputLength>50",
  },

  // ── 9. Quality-gate early exit ────────────────────────────────────────────
  {
    id: "quality-early-exit",
    area: "termination oracle: quality-based early termination",
    strategy: "plan-execute-reflect",
    maxIterations: 20,
    allowedTools: [],
    task: [
      "Explain the CAP theorem. Your answer must cover:",
      "(a) what each letter stands for,",
      "(b) the core trade-off,",
      "(c) a real-world example of each combination.",
      "Once you have a complete, high-quality answer, stop — do not keep adding content.",
    ].join(" "),
    expectation:
      "Terminates well before maxIterations=20 once quality gate passes. Should stop by iter 8.",
    passWhen: (r) => r.success && (r.maxIteration ?? 20) < 15,
    passLabel: "success + iter<15 (early exit, not exhausted)",
  },

  // ── 10. Context compaction: long accumulation task ────────────────────────
  {
    id: "context-compaction",
    area: "context-builder: message window compaction under pressure",
    strategy: "plan-execute-reflect",
    maxIterations: 18,
    allowedTools: [],
    task: [
      "Cover the history of programming languages across these 8 eras, writing 2–3 paragraphs for each:",
      "1. Machine code (1940s), 2. Assembly (1950s), 3. FORTRAN/COBOL (1950s–60s),",
      "4. Structured programming (1970s), 5. Object-oriented (1980s), 6. Scripting (1990s),",
      "7. Functional renaissance (2000s), 8. Modern multi-paradigm (2010s–present).",
    ].join(" "),
    expectation:
      "Auto-checkpoint fires before context limit. Compaction preserves coherence. Output covers all 8 eras.",
    passWhen: (r) => r.success && r.outputLength > 1500,
    passLabel: "success + outputLength>1500 (all 8 eras covered)",
  },

  // ── 11. Strategy switching: loop-triggered ───────────────────────────────
  {
    id: "strategy-switch-on-loop",
    area: "kernel-runner: loop-triggered strategy switching",
    strategy: "reactive",
    maxIterations: 12,
    allowedTools: [],
    task: [
      "Think through this problem step by step WITHOUT giving a final answer yet.",
      "Then think through it again differently. Then think through it a third time.",
      "Only after 3 separate rounds of thinking, give your final answer.",
      "Problem: Why does the halting problem prove that no general algorithm can determine if an arbitrary program will halt?",
    ].join(" "),
    expectation:
      "Loop detector fires after 3 consecutive thoughts. Strategy switch or nudge observed in JSONL.",
    passWhen: (r) => r.loopDetectorFired || r.strategySwitch || (r.maxIteration ?? 0) <= 5,
    passLabel: "loopDetectorFired OR strategySwitch OR iter≤5 (fast termination)",
  },

  // ── 12. Reflexion side-effect tool blocking ───────────────────────────────
  {
    id: "reflexion-no-repeat-sideeffects",
    area: "reflexion: side-effect tool deduplication",
    strategy: "reflexion",
    maxIterations: 10,
    allowedTools: ["web-search"],
    task: [
      "Search for 'TypeScript 5.0 release notes' using web-search.",
      "Then reflect on your answer. In your reflection pass, do NOT search again — use what you already found.",
    ].join(" "),
    expectation:
      "web-search called exactly once. Reflexion's side-effect guard blocks repeat calls in improvement pass.",
    passWhen: (r) => r.actPhaseCount === 1,
    passLabel: "actPhaseCount===1 (web-search called exactly once)",
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Runner
// ─────────────────────────────────────────────────────────────────────────────

async function runWideProbe(
  probe: WideProbeConfig,
): Promise<{ metrics: WideMetrics; output: string; passed: boolean }> {
  console.log(`\n${"=".repeat(74)}`);
  console.log(`WIDE PROBE:  ${probe.id}`);
  console.log(`Area:        ${probe.area}`);
  console.log(`Strategy:    ${probe.strategy}  maxIter=${probe.maxIterations}`);
  console.log(`Task:        ${probe.task.slice(0, 120)}${probe.task.length > 120 ? "…" : ""}`);
  console.log(`Expect:      ${probe.expectation}`);
  console.log("=".repeat(74));

  const jsonlPath = `${REPORT_DIR}/probe-wide-${probe.id}.jsonl`;

  let builder = ReactiveAgents.create()
    .withProvider("ollama")
    .withModel({ model: WIDE_MODEL });

  if (probe.useMaxIterationsDirect) {
    builder = builder.withMaxIterations(probe.maxIterations);
    builder = (builder as any).withReasoning({ defaultStrategy: probe.strategy as any });
  } else {
    builder = (builder as any).withReasoning({
      defaultStrategy: probe.strategy as any,
      maxIterations: probe.maxIterations,
    });
    // Also set via the correct path to ensure it's actually respected
    builder = builder.withMaxIterations(probe.maxIterations);
  }

  const toolsConfig: Record<string, unknown> = { allowedTools: probe.allowedTools };
  if (probe.requiredTools?.length) {
    toolsConfig.requiredTools = probe.requiredTools;
  }
  builder = (builder as any).withTools(toolsConfig);

  builder = (builder as any).withObservability({
    verbosity: "debug",
    live: false, // suppress per-token noise for wide run
    logModelIO: false,
    file: jsonlPath,
  });

  const agent = await (builder as any).build();
  const start = Date.now();
  let result: any;
  try {
    result = await agent.run(probe.task);
  } finally {
    await agent.dispose();
  }
  const durationMs = Date.now() - start;

  const parsed = parseWideMetrics(jsonlPath);
  const metrics: WideMetrics = {
    ...parsed,
    success: result.success,
    outputLength: (result.output ?? "").length,
    durationMs,
  };

  const passed = probe.passWhen(metrics);

  console.log(`\n--- RESULT ---`);
  console.log(`Passed:    ${passed ? "YES ✓" : "NO ✗"}   (${probe.passLabel})`);
  console.log(`Success:   ${metrics.success}  |  iter=${metrics.maxIteration ?? "?"}/${probe.maxIterations}  |  act=${metrics.actPhaseCount}`);
  console.log(`Quality:   ${metrics.finalQualityScore?.toFixed(3) ?? "?"}  |  ctxPeak=${metrics.contextPeakRatio != null ? (metrics.contextPeakRatio * 100).toFixed(1) + "%" : "?"}`);
  console.log(`Loop:      ${metrics.loopDetectorFired}  |  stratSwitch=${metrics.strategySwitch}  |  outLen=${metrics.outputLength}`);
  console.log(`Duration:  ${(durationMs / 1000).toFixed(1)}s`);
  if (result.output) {
    console.log(`\nOutput preview:\n${result.output.slice(0, 300)}`);
  }

  return { metrics, output: result.output ?? "", passed };
}

function parseWideMetrics(path: string): Omit<WideMetrics, "success" | "outputLength" | "durationMs"> {
  if (!existsSync(path)) {
    return {
      maxIteration: null,
      finalQualityScore: null,
      actPhaseCount: 0,
      loopDetectorFired: false,
      strategySwitch: false,
      contextPeakRatio: null,
    };
  }
  try {
    const lines = readFileSync(path, "utf-8").trim().split("\n").filter(Boolean);
    const records = lines.map((l) => {
      try {
        return JSON.parse(l) as Record<string, unknown>;
      } catch {
        return null;
      }
    }).filter(Boolean) as Record<string, unknown>[];

    const metrics = records.filter((r) => r._type === "metric");

    // Max iteration (execution.iteration gauge)
    const iterValues = metrics
      .filter((r) => r.name === "execution.iteration")
      .map((r) => r.value as number);
    const maxIteration = iterValues.length > 0 ? Math.max(...iterValues) : null;

    // Final quality (entropy.composite gauge — last emitted value)
    const qualityValues = metrics.filter((r) => r.name === "entropy.composite");
    const finalQualityScore =
      qualityValues.length > 0 ? (qualityValues.at(-1)?.value as number) : null;

    // Act phase count
    const actPhaseEntries = metrics.filter(
      (r) => r.name === "execution.phase.count" && (r as any).labels?.phase === "act",
    );
    const actPhaseCount = actPhaseEntries.reduce((s, r) => s + (r.value as number), 0);

    // Context peak ratio
    const ctxValues = metrics
      .filter(
        (r) =>
          r.name === "context.ratio" ||
          r.name === "context.pressure" ||
          r.name === "context.utilization",
      )
      .map((r) => r.value as number);
    const contextPeakRatio = ctxValues.length > 0 ? Math.max(...ctxValues) : null;

    // Loop detector: metric names or log text
    const loopMetricNames = ["reasoning.loop", "iteration.restart", "loop.detected"];
    const loopMetrics = metrics.filter((r) =>
      loopMetricNames.some((n) => (r.name as string | undefined)?.includes(n)),
    );
    const loopLogs = records.filter(
      (r) =>
        r._type === "log" &&
        (
          JSON.stringify(r).toLowerCase().includes("loop detect") ||
          JSON.stringify(r).toLowerCase().includes("reasoning_loop") ||
          JSON.stringify(r).toLowerCase().includes("nudg")
        ),
    );
    const loopDetectorFired = loopMetrics.length > 0 || loopLogs.length > 0;

    // Strategy switch
    const switchMetrics = metrics.filter((r) =>
      (r.name as string | undefined)?.includes("strategy.switch"),
    );
    const switchLogs = records.filter(
      (r) =>
        r._type === "log" &&
        JSON.stringify(r).toLowerCase().includes("strategy_switch"),
    );
    const strategySwitch = switchMetrics.length > 0 || switchLogs.length > 0;

    return {
      maxIteration,
      finalQualityScore,
      actPhaseCount,
      loopDetectorFired,
      strategySwitch,
      contextPeakRatio,
    };
  } catch {
    return {
      maxIteration: null,
      finalQualityScore: null,
      actPhaseCount: 0,
      loopDetectorFired: false,
      strategySwitch: false,
      contextPeakRatio: null,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Post-run JSON format check
// ─────────────────────────────────────────────────────────────────────────────

function checkJsonOutput(output: string): boolean {
  // Strip markdown fences if present
  const stripped = output.replace(/^```(?:json)?\s*/m, "").replace(/```\s*$/m, "").trim();
  try {
    const parsed = JSON.parse(stripped);
    return (
      Array.isArray(parsed?.languages) &&
      parsed.languages.length === 3 &&
      parsed.languages.every(
        (l: any) =>
          typeof l.name === "string" &&
          typeof l.year === "number" &&
          typeof l.paradigm === "string",
      )
    );
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

interface WideResult {
  id: string;
  area: string;
  strategy: string;
  passed: boolean;
  passLabel: string;
  metrics: Omit<WideMetrics, "durationMs">;
  durationMs: number;
  notes?: string;
}

async function main() {
  mkdirSync(REPORT_DIR, { recursive: true });

  console.log(`Wide feature sweep — model: ${WIDE_MODEL}`);
  console.log(`Probes: ${WIDE_PROBES.length}`);
  console.log(`Report dir: ${REPORT_DIR}\n`);

  const results: WideResult[] = [];

  for (const probe of WIDE_PROBES) {
    const { metrics, output, passed: rawPassed } = await runWideProbe(probe);

    // Post-hoc JSON check for the output-format-json probe
    let finalPassed = rawPassed;
    let notes: string | undefined;
    if (probe.id === "output-format-json") {
      const jsonValid = checkJsonOutput(output);
      finalPassed = jsonValid;
      notes = `JSON parse: ${jsonValid ? "✓ valid" : "✗ invalid"}`;
    }

    results.push({
      id: probe.id,
      area: probe.area,
      strategy: probe.strategy,
      passed: finalPassed,
      passLabel: probe.passLabel,
      metrics: {
        maxIteration: metrics.maxIteration,
        finalQualityScore: metrics.finalQualityScore,
        actPhaseCount: metrics.actPhaseCount,
        loopDetectorFired: metrics.loopDetectorFired,
        strategySwitch: metrics.strategySwitch,
        contextPeakRatio: metrics.contextPeakRatio,
        success: metrics.success,
        outputLength: metrics.outputLength,
      },
      durationMs: metrics.durationMs,
      notes,
    });
  }

  // ── Summary table ──────────────────────────────────────────────────────────
  const summaryPath = `${REPORT_DIR}/probe-wide-summary-${new Date()
    .toISOString()
    .slice(0, 16)
    .replace("T", "-")}.json`;
  writeFileSync(summaryPath, JSON.stringify(results, null, 2));

  console.log(`\n${"=".repeat(74)}`);
  console.log(`WIDE FEATURE SWEEP SUMMARY   model=${WIDE_MODEL}`);
  console.log("=".repeat(74));
  console.log(
    `${"ID".padEnd(38)} ${"PASS".padEnd(6)} ${"ITER".padEnd(6)} ${"ACT".padEnd(5)} AREA`,
  );
  console.log("-".repeat(74));
  for (const r of results) {
    const mark = r.passed ? "✓" : "✗";
    const iter = String(r.metrics.maxIteration ?? "?").padStart(4);
    const act = String(r.metrics.actPhaseCount).padStart(3);
    console.log(
      `${r.id.padEnd(38)} ${mark.padEnd(6)} ${iter.padEnd(6)} ${act.padEnd(5)} ${r.area.slice(0, 40)}`,
    );
  }

  const passCount = results.filter((r) => r.passed).length;
  const failList = results.filter((r) => !r.passed).map((r) => r.id);

  console.log(`\n${passCount}/${results.length} passed`);
  if (failList.length > 0) {
    console.log(`\nFAILED probes:`);
    for (const id of failList) {
      const r = results.find((x) => x.id === id)!;
      console.log(`  ✗ ${id}  (${r.passLabel})`);
      if (r.notes) console.log(`    ${r.notes}`);
    }
  }

  console.log(`\nSummary JSON: ${summaryPath}`);
  console.log(`JSONL logs:   ${REPORT_DIR}/probe-wide-{id}.jsonl`);
}

main().catch(console.error);
