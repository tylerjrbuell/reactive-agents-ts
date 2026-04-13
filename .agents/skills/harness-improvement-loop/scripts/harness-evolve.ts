// harness-evolve.ts — Self-improving harness loop evolution engine
//
// Runs after each probe pass to:
//   1. Analyze all probe JSONL files (uses harness-probe-analyze.ts logic)
//   2. Compare against known pass criteria and regression baselines
//   3. Compute probe effectiveness (signal ratio, false-negative rate)
//   4. Identify coverage gaps across all framework feature areas
//   5. Generate next-pass probe candidates:
//      - Failing probes → targeted drill-down variants
//      - Consistently-passing probes → graduated harder variants
//      - Uncovered areas → new probes
//   6. Update harness-reports/loop-state.json with accumulated knowledge
//
// Usage:
//   bun run scripts/harness-evolve.ts
//   bun run scripts/harness-evolve.ts --dry-run     # print plan, don't write

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { analyzeProbeJsonl, type ProbeAnalysis } from "./harness-probe-analyze.js";

const REPORT_DIR = "./harness-reports";
const LOOP_STATE_PATH = join(REPORT_DIR, "loop-state.json");
const DRY_RUN = process.argv.includes("--dry-run");

// ─────────────────────────────────────────────────────────────────────────────
// Loop State Schema
// ─────────────────────────────────────────────────────────────────────────────

interface KnownWeakness {
  id: string;
  title: string;
  severity: "high" | "medium" | "low";
  status: "open" | "confirmed" | "fixed" | "wont-fix";
  probeId: string;
  confirmedInPasses: string[];
  fixedInPass?: string;
  targetFiles: string[];
  ic?: string; // improvement candidate ID
  regressionRisk?: string;
}

interface RegressionBaseline {
  probeId: string;
  metric: "iterations" | "actPhaseCount" | "kernelSteps" | "finalEntropy";
  expected: number;
  tolerance: number; // absolute tolerance
  direction: "at-most" | "at-least" | "exactly";
}

interface MetricRegistryEntry {
  name: string;
  type: string;
  description: string;
  discoveredAt: string;
  labelsObserved: string[];
}

interface ProbeHistoryEntry {
  probeId: string;
  passCount: number;
  failCount: number;
  confirmedBug: boolean; // did this probe catch a real issue at least once?
  graduated: boolean; // replaced by a harder variant
  lastResult: {
    passId: string;
    passed: boolean;
    iterations: number | null;
    actPhaseCount: number;
    hadLoopSignal: boolean;
  };
}

interface LoopPass {
  id: string;  // YYYYMMDD-N
  date: string;
  scripts: string[];
  models: string[];
  probeCount: number;
  passCount: number;
  failCount: number;
  weaknessIds: string[];
  newWeaknessIds: string[];
  fixedWeaknessIds: string[];
}

interface LoopState {
  version: number;
  lastUpdated: string;
  passes: LoopPass[];
  knownWeaknesses: KnownWeakness[];
  regressionBaselines: RegressionBaseline[];
  metricRegistry: MetricRegistryEntry[];
  probeHistory: ProbeHistoryEntry[];
  nextPassFocus: string[];
  coverageMap: Record<string, "covered" | "partial" | "uncovered">;
}

// ─────────────────────────────────────────────────────────────────────────────
// Coverage map: all major framework feature areas
// ─────────────────────────────────────────────────────────────────────────────

const ALL_FEATURE_AREAS: Record<string, string> = {
  // Core kernel
  "reactive-strategy": "reactive.ts — single-step ReAct loop",
  "plan-execute-reflect": "plan-execute.ts — plan + execute + reflect phases",
  "reflexion": "reflexion.ts — self-critique + improvement loop",
  "tree-of-thought": "tree-of-thought.ts — candidate expansion + evaluation",
  "adaptive-routing": "adaptive.ts — strategy classification + dispatch",

  // Kernel utilities
  "loop-detector": "loop-detector.ts — consecutive thought detection",
  "ics-coordinator": "ics-coordinator.ts — required tool nudge injection",
  "termination-oracle": "termination-oracle.ts — early exit quality gate",
  "context-compaction": "context-utils.ts — message window sliding + compaction",
  "auto-checkpoint": "auto-checkpoint.ts — state save at soft pressure zone",
  "output-synthesis": "output-synthesis.ts — final output assembly + format validation",
  "task-intent": "task-intent.ts — output format detection from task prompt",

  // Guard + act
  "guard-duplicate-tool": "guard.ts — duplicate tool call prevention",
  "guard-required-tools": "guard.ts + ics-coordinator — required tools enforcement",
  "native-fc-parsing": "stream-parser.ts — native function call event parsing",
  "text-fc-fallback": "stream-parser.ts — text-format tool call recovery (W1)",

  // Strategy-level features
  "strategy-switching": "kernel-runner.ts — loop-triggered strategy escalation",
  "max-iterations-wiring": "builder.ts → kernel-runner.ts — withReasoning maxIterations propagation (W4)",
  "context-pressure-narrowing": "think.ts — drop all tools except final-answer at pressure threshold",
  "quality-early-exit": "termination-oracle.ts — halt before maxIterations on high-quality output",

  // Provider layer
  "ollama-native-fc": "ollama provider — tool_calls from done chunk",
  "anthropic-streaming": "anthropic provider — streaming FC event handling",

  // Builder API
  "builder-tools-config": "builder.ts — .withTools() allowedTools + requiredTools",
  "builder-observability": "builder.ts — .withObservability() JSONL output",
  "builder-reasoning-options": "builder.ts — .withReasoning() strategy + maxIterations",
};

// ─────────────────────────────────────────────────────────────────────────────
// Pass criteria: expected metrics for each probe pattern
// ─────────────────────────────────────────────────────────────────────────────

interface PassCriteria {
  maxIterations?: number;        // iterations must be ≤ this
  minActPhase?: number;          // actPhaseCount must be ≥ this
  maxActPhase?: number;          // actPhaseCount must be ≤ this
  maxKernelSteps?: number;       // kernelSteps must be ≤ this
  requiresNoLoopSignal?: boolean; // loopSignals must be empty
  requiresLoopSignal?: boolean;  // loopSignals must be non-empty
  requiresConvergence?: boolean; // convergenceIteration must not be null
  maxEntropy?: number;           // finalEntropy must be ≤ this
  probeIdPattern?: RegExp;       // applies to probes matching this pattern
  reason: string;
}

// Pass criteria keyed by probe ID (or partial probe ID substring)
const PROBE_PASS_CRITERIA: Record<string, PassCriteria[]> = {
  "trivial-1step": [
    { maxIterations: 1, maxActPhase: 0, reason: "trivial arithmetic → 1 iter, no tools" },
  ],
  "multistep-research": [
    { maxIterations: 10, reason: "research task should finish well before 15 iter limit" },
  ],
  "tool-heavy": [
    { minActPhase: 1, reason: "tool-heavy probe must execute at least one tool call" },
    { maxKernelSteps: 30, reason: "should not spiral beyond 30 kernel steps" },
  ],
  "context-pressure": [
    { maxIterations: 18, reason: "should complete, not hit hard maxIterations cap" },
  ],
  "termination-quality": [
    {
      maxIterations: 14,
      reason: "quality gate should halt before exhausting 20 iterations",
    },
  ],
  // confirm probes
  "w2-ics-required-tool": [
    { requiresLoopSignal: false, reason: "W2 confirmed if loop NEVER fires despite many iters" },
  ],
  "w2-no-ics-baseline": [
    { maxIterations: 5, reason: "without ICS masking, loop should fire by iter 4" },
  ],
  "w4-reasoning-opt-maxiter": [
    { maxIterations: 3, reason: "bug = exceeds 3 when withReasoning({ maxIterations: 3 }) used" },
  ],
  "w4-direct-maxiter": [
    { maxIterations: 3, reason: "correct path = stops at 3 with withMaxIterations(3)" },
  ],
  // wide probes
  "direct-answer-efficiency": [
    { maxIterations: 1, maxKernelSteps: 3, reason: "pure knowledge, no tools → 1 iter max" },
  ],
  "required-tools-satisfied": [
    { minActPhase: 1, reason: "native FC model must execute required tool" },
  ],
  "duplicate-tool-guard": [
    { maxActPhase: 1, reason: "guard should block second identical call" },
  ],
  "reflexion-no-repeat-sideeffects": [
    { maxActPhase: 1, reason: "reflexion must not re-run web-search in improvement pass" },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Probe graduation templates (harder variants for consistently-passing probes)
// ─────────────────────────────────────────────────────────────────────────────

const GRADUATION_TEMPLATES: Record<string, string> = {
  "trivial-1step": `// GRADUATED from trivial-1step (consistently passes)
// Tests direct-answer fast-path with a slightly harder arithmetic task
{
  id: "trivial-multistep-math",
  strategy: "reactive",
  maxIterations: 5,
  allowedTools: [],
  task: "Calculate: (347 × 28) - (156 × 13) + sqrt(144). Show intermediate steps.",
  expectation: "≤2 iterations, no tools, exact numerical answer",
}`,

  "direct-answer-efficiency": `// GRADUATED from direct-answer-efficiency
// Tests efficient answer under context-rich system prompt
{
  id: "direct-answer-dense-context",
  strategy: "reactive",
  maxIterations: 5,
  allowedTools: [],
  task: "In exactly 3 sentences: what is the difference between synchronous and asynchronous programming?",
  expectation: "1 iteration, output is exactly 3 sentences",
}`,

  "output-format-json": `// GRADUATED from output-format-json
// Tests nested JSON schema compliance
{
  id: "output-format-nested-json",
  strategy: "reactive",
  maxIterations: 6,
  allowedTools: [],
  task: 'Respond ONLY with valid JSON: {"report": {"title": string, "sections": [{"heading": string, "content": string}]}}. Create a 2-section report about TypeScript generics.',
  expectation: "parseable JSON matching nested schema, no extra text",
}`,
};

// ─────────────────────────────────────────────────────────────────────────────
// Drill-down templates (isolating root causes of failing probes)
// ─────────────────────────────────────────────────────────────────────────────

function generateDrillDownProbe(
  analysis: ProbeAnalysis,
  criteria: PassCriteria,
): string | null {
  const id = analysis.probeId;

  // Too many iterations
  if (
    criteria.maxIterations != null &&
    (analysis.iterations ?? 0) > criteria.maxIterations
  ) {
    return `// DRILL-DOWN: ${id} exceeded maxIterations (got ${analysis.iterations}, expected ≤${criteria.maxIterations})
// Targets: does maxIterations hard stop work? Is ICS redirect loop involved?
{
  id: "${id}-maxiter-drill",
  strategy: "reactive",
  maxIterations: ${Math.min(criteria.maxIterations, 3)},
  useMaxIterationsDirect: true,  // use .withMaxIterations() not withReasoning()
  allowedTools: [],
  task: "${analysis.file.includes("tool-heavy") ? "What is 2+2?" : "Explain recursion in one sentence."}",
  expectation: "Hard stop at maxIterations=${Math.min(criteria.maxIterations, 3)}. Confirms kernel loop respects limit.",
}`;
  }

  // No act phase (tool call never executed)
  if (criteria.minActPhase != null && analysis.actPhaseCount < criteria.minActPhase) {
    return `// DRILL-DOWN: ${id} had zero act phases (expected ≥${criteria.minActPhase})
// Targets: is FC parsing broken (W1)? Are tools in allowedTools but not being parsed?
// Compare: native FC model (qwen3:14b) vs text-format model (cogito:8b)
{
  id: "${id}-fc-drill",
  strategy: "reactive",
  maxIterations: 4,
  allowedTools: ["web-search"],
  task: 'Call web-search with query "test query". Return the raw result.',
  expectation: "actPhaseCount ≥ 1. If 0 with cogito → W1 confirmed. If 0 with qwen3 → deeper FC bug.",
}`;
  }

  // Loop signal firing unexpectedly
  if (criteria.requiresNoLoopSignal && analysis.hadLoopSignal) {
    return `// DRILL-DOWN: ${id} had unexpected loop signal
// Targets: what triggered loop detection? Was it a real loop or a false positive?
{
  id: "${id}-loop-cause-drill",
  strategy: "reactive",
  maxIterations: 6,
  allowedTools: [],
  task: "Think through this problem in exactly 2 steps, then answer: What is the Pythagorean theorem?",
  expectation: "No loop signal. Consecutive thoughts are intentional, not a loop.",
}`;
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main evolution logic
// ─────────────────────────────────────────────────────────────────────────────

function loadLoopState(): LoopState {
  if (existsSync(LOOP_STATE_PATH)) {
    return JSON.parse(readFileSync(LOOP_STATE_PATH, "utf-8")) as LoopState;
  }
  // Default empty state
  return {
    version: 1,
    lastUpdated: new Date().toISOString(),
    passes: [],
    knownWeaknesses: [],
    regressionBaselines: [],
    metricRegistry: [],
    probeHistory: [],
    nextPassFocus: [],
    coverageMap: Object.fromEntries(
      Object.keys(ALL_FEATURE_AREAS).map((k) => [k, "uncovered"]),
    ) as Record<string, "covered" | "partial" | "uncovered">,
  };
}

function saveLoopState(state: LoopState): void {
  state.lastUpdated = new Date().toISOString();
  writeFileSync(LOOP_STATE_PATH, JSON.stringify(state, null, 2));
}

function updateMetricRegistry(
  state: LoopState,
  analyses: ProbeAnalysis[],
): void {
  const knownNames = new Set(state.metricRegistry.map((e) => e.name));
  const now = new Date().toISOString();

  for (const a of analyses) {
    for (const name of a.discoveredMetricNames) {
      if (!knownNames.has(name)) {
        state.metricRegistry.push({
          name,
          type: "unknown",
          description: "",
          discoveredAt: now,
          labelsObserved: [],
        });
        knownNames.add(name);
      }
    }
  }
  // Sort for stable output
  state.metricRegistry.sort((a, b) => a.name.localeCompare(b.name));
}

function updateCoverageMap(
  state: LoopState,
  analyses: ProbeAnalysis[],
): void {
  const probeIds = new Set(analyses.map((a) => a.probeId));

  // Map probe IDs to feature areas they cover
  const coverageRules: Array<[RegExp, string[]]> = [
    [/trivial|direct-answer/, ["reactive-strategy", "termination-oracle"]],
    [/multistep-research|plan-decomp/, ["plan-execute-reflect", "termination-oracle"]],
    [/tool-heavy|required-tool|fc-basic|fc-drill/, ["native-fc-parsing", "guard-required-tools"]],
    [/context-pressure|context-compact/, ["context-compaction", "auto-checkpoint"]],
    [/termination-quality|quality-early/, ["termination-oracle", "quality-early-exit"]],
    [/loop-ics|w2-ics/, ["loop-detector", "ics-coordinator"]],
    [/w4-|maxiter/, ["max-iterations-wiring", "builder-reasoning-options"]],
    [/adaptive/, ["adaptive-routing"]],
    [/reflexion/, ["reflexion"]],
    [/tree-of-thought|tot/, ["tree-of-thought"]],
    [/output-format/, ["output-synthesis", "task-intent"]],
    [/duplicate-tool/, ["guard-duplicate-tool"]],
    [/strategy-switch/, ["strategy-switching"]],
    [/cogito|text-fc/, ["text-fc-fallback"]],
    [/w1-/, ["text-fc-fallback", "native-fc-parsing"]],
  ];

  for (const probeId of probeIds) {
    for (const [pattern, areas] of coverageRules) {
      if (pattern.test(probeId)) {
        for (const area of areas) {
          if (state.coverageMap[area] === "uncovered") {
            state.coverageMap[area] = "partial";
          }
        }
      }
    }
  }
}

function evaluatePassCriteria(
  analysis: ProbeAnalysis,
): Array<{ criteria: PassCriteria; passed: boolean; actual: string }> {
  const results: Array<{ criteria: PassCriteria; passed: boolean; actual: string }> = [];

  for (const [pattern, criteriaList] of Object.entries(PROBE_PASS_CRITERIA)) {
    if (!analysis.probeId.includes(pattern)) continue;

    for (const criteria of criteriaList) {
      let passed = true;
      const actuals: string[] = [];

      if (criteria.maxIterations != null) {
        const ok = (analysis.iterations ?? 999) <= criteria.maxIterations;
        if (!ok) passed = false;
        actuals.push(`iter=${analysis.iterations ?? "?"} (max=${criteria.maxIterations})`);
      }
      if (criteria.maxActPhase != null) {
        const ok = analysis.actPhaseCount <= criteria.maxActPhase;
        if (!ok) passed = false;
        actuals.push(`act=${analysis.actPhaseCount} (max=${criteria.maxActPhase})`);
      }
      if (criteria.minActPhase != null) {
        const ok = analysis.actPhaseCount >= criteria.minActPhase;
        if (!ok) passed = false;
        actuals.push(`act=${analysis.actPhaseCount} (min=${criteria.minActPhase})`);
      }
      if (criteria.maxKernelSteps != null) {
        const ok = analysis.kernelSteps <= criteria.maxKernelSteps;
        if (!ok) passed = false;
        actuals.push(`steps=${analysis.kernelSteps} (max=${criteria.maxKernelSteps})`);
      }
      if (criteria.requiresLoopSignal === false && analysis.hadLoopSignal) {
        passed = false;
        actuals.push(`unexpectedLoopSignal=true`);
      }
      if (criteria.requiresLoopSignal === true && !analysis.hadLoopSignal) {
        passed = false;
        actuals.push(`noLoopSignal (required)`);
      }

      results.push({ criteria, passed, actual: actuals.join(", ") });
    }
  }

  return results;
}

function updateProbeHistory(
  state: LoopState,
  analysis: ProbeAnalysis,
  passed: boolean,
  passId: string,
): void {
  let entry = state.probeHistory.find((h) => h.probeId === analysis.probeId);
  if (!entry) {
    entry = {
      probeId: analysis.probeId,
      passCount: 0,
      failCount: 0,
      confirmedBug: false,
      graduated: false,
      lastResult: {
        passId,
        passed,
        iterations: analysis.iterations,
        actPhaseCount: analysis.actPhaseCount,
        hadLoopSignal: analysis.hadLoopSignal,
      },
    };
    state.probeHistory.push(entry);
  }
  if (passed) entry.passCount++;
  else {
    entry.failCount++;
    entry.confirmedBug = true;
  }
  entry.lastResult = {
    passId,
    passed,
    iterations: analysis.iterations,
    actPhaseCount: analysis.actPhaseCount,
    hadLoopSignal: analysis.hadLoopSignal,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

function main() {
  mkdirSync(REPORT_DIR, { recursive: true });

  console.log("=".repeat(72));
  console.log("HARNESS EVOLUTION ENGINE");
  console.log(`State:   ${LOOP_STATE_PATH}`);
  console.log(`Mode:    ${DRY_RUN ? "DRY RUN (no writes)" : "live"}`);
  console.log("=".repeat(72));

  // Load loop state
  const state = loadLoopState();
  console.log(
    `\nLoaded loop state: ${state.passes.length} prior passes, ${state.knownWeaknesses.length} known weaknesses`,
  );

  // Discover and analyze all JSONL files
  const jsonlFiles = readdirSync(REPORT_DIR)
    .filter((f) => f.startsWith("probe-") && f.endsWith(".jsonl") && !f.includes("analysis"))
    .map((f) => join(REPORT_DIR, f))
    .sort();

  if (jsonlFiles.length === 0) {
    console.log("\nNo probe JSONL files found in harness-reports/");
    console.log("Run probe scripts first:");
    console.log("  bun run scripts/harness-probe.ts");
    console.log("  bun run scripts/harness-probe-confirm.ts");
    console.log("  bun run scripts/harness-probe-wide.ts");
    return;
  }

  console.log(`\nAnalyzing ${jsonlFiles.length} JSONL files...`);
  const analyses: ProbeAnalysis[] = jsonlFiles.map((f) => analyzeProbeJsonl(f));

  // Evaluate pass criteria for each probe
  const passId = new Date().toISOString().slice(0, 16).replace("T", "-");
  const probeResults: Array<{
    analysis: ProbeAnalysis;
    evaluations: ReturnType<typeof evaluatePassCriteria>;
    overallPassed: boolean;
  }> = [];

  for (const a of analyses) {
    const evals = evaluatePassCriteria(a);
    const overallPassed = evals.length === 0 || evals.every((e) => e.passed);
    probeResults.push({ analysis: a, evaluations: evals, overallPassed });
    updateProbeHistory(state, a, overallPassed, passId);
  }

  // Update metric registry
  updateMetricRegistry(state, analyses);

  // Update coverage map
  updateCoverageMap(state, analyses);

  // ── Print evaluation results ───────────────────────────────────────────────
  console.log("\n" + "─".repeat(72));
  console.log("PROBE EVALUATION RESULTS");
  console.log("─".repeat(72));

  const failing = probeResults.filter((r) => !r.overallPassed);
  const passing = probeResults.filter((r) => r.overallPassed);
  const unchecked = probeResults.filter((r) => r.evaluations.length === 0);

  for (const { analysis: a, evaluations, overallPassed } of probeResults) {
    const mark = evaluations.length === 0 ? "  ~" : overallPassed ? "  ✓" : "  ✗";
    console.log(`${mark} ${a.probeId.padEnd(38)} iter=${String(a.iterations ?? "?").padStart(3)}  act=${a.actPhaseCount}  steps=${a.kernelSteps}`);
    for (const e of evaluations) {
      if (!e.passed) {
        console.log(`       FAIL: ${e.criteria.reason}`);
        console.log(`             actual: ${e.actual}`);
      }
    }
  }

  console.log(`\n  Passed:    ${passing.length}/${probeResults.length}`);
  console.log(`  Failed:    ${failing.length}/${probeResults.length}`);
  console.log(`  Unchecked: ${unchecked.length}/${probeResults.length} (no criteria defined)`);

  // ── Coverage gaps ─────────────────────────────────────────────────────────
  const uncovered = Object.entries(state.coverageMap)
    .filter(([, status]) => status === "uncovered")
    .map(([area]) => area);
  const partial = Object.entries(state.coverageMap)
    .filter(([, status]) => status === "partial")
    .map(([area]) => area);

  console.log("\n" + "─".repeat(72));
  console.log("COVERAGE GAPS");
  console.log("─".repeat(72));
  console.log(`  Uncovered (${uncovered.length}): ${uncovered.join(", ") || "none"}`);
  console.log(`  Partial   (${partial.length}): ${partial.join(", ") || "none"}`);

  // ── Probe evolution plan ──────────────────────────────────────────────────
  console.log("\n" + "─".repeat(72));
  console.log("PROBE EVOLUTION PLAN");
  console.log("─".repeat(72));

  const nextPassProbes: string[] = [];
  const nextPassFocus: string[] = [];

  // 1. Drill-downs for failing probes
  for (const { analysis, evaluations } of failing) {
    for (const e of evaluations) {
      if (!e.passed) {
        const drill = generateDrillDownProbe(analysis, e.criteria);
        if (drill) {
          console.log(`\n[DRILL-DOWN] ${analysis.probeId} — ${e.criteria.reason}`);
          console.log(drill);
          nextPassProbes.push(drill);
          nextPassFocus.push(`drill-down: ${analysis.probeId}`);
        }
      }
    }
  }

  // 2. Graduation for consistently-passing probes
  for (const { analysis } of passing) {
    const history = state.probeHistory.find((h) => h.probeId === analysis.probeId);
    if (history && history.passCount >= 2 && !history.graduated) {
      const template = GRADUATION_TEMPLATES[analysis.probeId];
      if (template) {
        console.log(`\n[GRADUATE] ${analysis.probeId} (passed ${history.passCount}x) → harder variant`);
        console.log(template);
        nextPassProbes.push(template);
        nextPassFocus.push(`graduate: ${analysis.probeId}`);
        if (!DRY_RUN) history.graduated = true;
      }
    }
  }

  // 3. New probes for uncovered high-priority areas
  const highPriorityUncovered = [
    "text-fc-fallback",
    "max-iterations-wiring",
    "loop-detector",
    "strategy-switching",
    "quality-early-exit",
    "context-pressure-narrowing",
    "reflexion",
    "tree-of-thought",
    "adaptive-routing",
  ].filter((area) => state.coverageMap[area] === "uncovered");

  if (highPriorityUncovered.length > 0) {
    console.log(`\n[NEW PROBES NEEDED] Uncovered high-priority areas:`);
    for (const area of highPriorityUncovered.slice(0, 5)) {
      console.log(`  → ${area}: ${ALL_FEATURE_AREAS[area]}`);
      nextPassFocus.push(`new coverage: ${area}`);
    }
  }

  // ── Regression check ──────────────────────────────────────────────────────
  console.log("\n" + "─".repeat(72));
  console.log("REGRESSION CHECK");
  console.log("─".repeat(72));

  let regressions = 0;
  for (const baseline of state.regressionBaselines) {
    const a = analyses.find((x) => x.probeId === baseline.probeId);
    if (!a) continue;

    const actual =
      baseline.metric === "iterations" ? a.iterations :
      baseline.metric === "actPhaseCount" ? a.actPhaseCount :
      baseline.metric === "kernelSteps" ? a.kernelSteps :
      baseline.metric === "finalEntropy" ? a.finalEntropy :
      null;

    if (actual == null) continue;

    const expected = baseline.expected;
    const tol = baseline.tolerance;
    let violated = false;

    if (baseline.direction === "at-most" && actual > expected + tol) violated = true;
    if (baseline.direction === "at-least" && actual < expected - tol) violated = true;
    if (baseline.direction === "exactly" && Math.abs(actual - expected) > tol) violated = true;

    if (violated) {
      regressions++;
      console.log(`  ⚠ REGRESSION: ${baseline.probeId}.${baseline.metric} = ${actual}, expected ${baseline.direction} ${expected} ± ${tol}`);
    } else {
      console.log(`  ✓ OK: ${baseline.probeId}.${baseline.metric} = ${actual} (${baseline.direction} ${expected})`);
    }
  }

  if (state.regressionBaselines.length === 0) {
    console.log("  (no baselines established yet — add them after a clean pass)");
  }
  if (regressions === 0 && state.regressionBaselines.length > 0) {
    console.log("  All baselines holding.");
  }

  // ── Metric registry update ────────────────────────────────────────────────
  const newMetrics = state.metricRegistry.filter(
    (m) => !state.passes.some(() => true) // always new on first run
  );
  console.log(`\n  Metric registry: ${state.metricRegistry.length} names known`);
  console.log(`  Coverage map: ${Object.values(state.coverageMap).filter((v) => v === "covered").length} covered, ${partial.length} partial, ${uncovered.length} uncovered`);

  // ── Write next-pass probe candidates ─────────────────────────────────────
  const candidatePath = join(
    REPORT_DIR,
    `probe-candidates-${new Date().toISOString().slice(0, 16).replace("T", "-")}.ts`,
  );

  if (!DRY_RUN && nextPassProbes.length > 0) {
    const content = [
      `// Next-pass probe candidates — generated by harness-evolve.ts`,
      `// Date: ${new Date().toISOString()}`,
      `// Copy relevant entries into scripts/harness-probe-wide.ts or harness-probe-confirm.ts`,
      ``,
      ...nextPassProbes.map((p, i) => `// ── Candidate ${i + 1} ──\n${p}\n`),
    ].join("\n");
    writeFileSync(candidatePath, content);
    console.log(`\n  → Probe candidates: ${candidatePath}`);
  }

  // ── Save updated loop state ───────────────────────────────────────────────
  state.nextPassFocus = nextPassFocus.slice(0, 10); // keep top 10

  if (!DRY_RUN) {
    saveLoopState(state);
    console.log(`  → Loop state updated: ${LOOP_STATE_PATH}`);
  } else {
    console.log("\n(dry-run: no files written)");
  }

  // ── Final summary ─────────────────────────────────────────────────────────
  console.log("\n" + "=".repeat(72));
  console.log("EVOLUTION SUMMARY");
  console.log("=".repeat(72));
  console.log(`  Probes analyzed:     ${analyses.length}`);
  console.log(`  Pass / Fail:         ${passing.length} / ${failing.length}`);
  console.log(`  Regressions:         ${regressions}`);
  console.log(`  New probe candidates:${nextPassProbes.length}`);
  console.log(`  Coverage gaps:       ${uncovered.length} uncovered, ${partial.length} partial`);
  console.log(`\n  Next pass focus:`);
  for (const focus of state.nextPassFocus.slice(0, 6)) {
    console.log(`    • ${focus}`);
  }
  if (state.nextPassFocus.length === 0) {
    console.log(`    • (all pass criteria met — raise the bar by graduating probes)`);
  }
}

main();
