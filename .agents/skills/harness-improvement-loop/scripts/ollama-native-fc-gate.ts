import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

type FrequencyMap = Record<string, number>;

type ScenarioAggregate = {
  readonly runs: number;
  readonly sdkCallCountFrequency: FrequencyMap;
  readonly frameworkCallCountFrequency: FrequencyMap;
  readonly frameworkNoThinkingCallCountFrequency: FrequencyMap;
  readonly mismatchRuns: number;
  readonly mismatchNoThinkingRuns: number;
};

type ProbeReport = {
  readonly generatedAt: string;
  readonly model: string;
  readonly repeats: number;
  readonly aggregateByScenario: Record<string, ScenarioAggregate>;
};

const REPORTS_DIR = join(process.cwd(), "harness-reports");
const MIN_RUNS = Math.max(1, Number(process.env.PROBE_MIN_RUNS ?? "3"));
const ALLOW_MISMATCH_RUNS = Math.max(0, Number(process.env.PROBE_ALLOW_MISMATCH_RUNS ?? "0"));
const ALLOW_MISMATCH_NO_THINKING_RUNS = Math.max(
  0,
  Number(process.env.PROBE_ALLOW_MISMATCH_NO_THINKING_RUNS ?? "0"),
);

const EXPECTED_COUNTS: Record<string, number> = {
  "fresh-task-parallel": 4,
  "after-one-result-nudge": 3,
  "conflicting-nudges": 4,
  "replay-failing-thread-shape": 2,
};

function latestProbeReportPath(): string {
  const files = readdirSync(REPORTS_DIR)
    .filter((name) => name.startsWith("ollama-native-fc-context-probe-") && name.endsWith(".json"))
    .sort();
  const latest = files.at(-1);
  if (!latest) {
    throw new Error(`No probe reports found in ${REPORTS_DIR}`);
  }
  return join(REPORTS_DIR, latest);
}

function loadReport(pathArg?: string): { readonly path: string; readonly report: ProbeReport } {
  const path = pathArg ?? latestProbeReportPath();
  const parsed = JSON.parse(readFileSync(path, "utf-8")) as ProbeReport;
  if (!parsed.aggregateByScenario) {
    throw new Error(`Report at ${path} is missing aggregateByScenario`);
  }
  return { path, report: parsed };
}

function dominantCount(freq: FrequencyMap): number | null {
  const entries = Object.entries(freq);
  if (entries.length === 0) return null;
  entries.sort((a, b) => b[1] - a[1]);
  const [count] = entries[0]!;
  const asNumber = Number(count);
  return Number.isFinite(asNumber) ? asNumber : null;
}

function validateScenario(
  scenarioId: string,
  aggregate: ScenarioAggregate,
): { readonly passed: boolean; readonly reasons: readonly string[] } {
  const reasons: string[] = [];
  const expectedCount = EXPECTED_COUNTS[scenarioId];
  if (!expectedCount) {
    reasons.push(`No expected call-count baseline configured for ${scenarioId}`);
    return { passed: false, reasons };
  }

  if (aggregate.runs < MIN_RUNS) {
    reasons.push(`Only ${aggregate.runs} runs recorded (min required: ${MIN_RUNS})`);
  }

  const sdkDominant = dominantCount(aggregate.sdkCallCountFrequency);
  const fwDominant = dominantCount(aggregate.frameworkCallCountFrequency);
  const fwNoThinkingDominant = dominantCount(aggregate.frameworkNoThinkingCallCountFrequency);

  if (sdkDominant !== expectedCount) {
    reasons.push(`SDK dominant count ${sdkDominant ?? "n/a"} != expected ${expectedCount}`);
  }
  if (fwDominant !== expectedCount) {
    reasons.push(`Framework dominant count ${fwDominant ?? "n/a"} != expected ${expectedCount}`);
  }
  if (fwNoThinkingDominant !== expectedCount) {
    reasons.push(
      `Framework(thinking=false) dominant count ${fwNoThinkingDominant ?? "n/a"} != expected ${expectedCount}`,
    );
  }
  if (aggregate.mismatchRuns > ALLOW_MISMATCH_RUNS) {
    reasons.push(
      `Mismatch runs ${aggregate.mismatchRuns} exceed allowed ${ALLOW_MISMATCH_RUNS}`,
    );
  }
  if (aggregate.mismatchNoThinkingRuns > ALLOW_MISMATCH_NO_THINKING_RUNS) {
    reasons.push(
      `Mismatch runs (thinking=false) ${aggregate.mismatchNoThinkingRuns} exceed allowed ${ALLOW_MISMATCH_NO_THINKING_RUNS}`,
    );
  }

  return {
    passed: reasons.length === 0,
    reasons,
  };
}

function main(): void {
  const { path, report } = loadReport(process.argv[2]);
  const scenarioIds = Object.keys(EXPECTED_COUNTS);
  let failed = false;

  console.log(`Ollama FC gate report: ${path}`);
  console.log(`Generated: ${report.generatedAt}`);
  console.log(`Model: ${report.model}`);
  console.log(`Repeats: ${report.repeats}`);
  console.log("");

  for (const scenarioId of scenarioIds) {
    const aggregate = report.aggregateByScenario[scenarioId];
    if (!aggregate) {
      failed = true;
      console.log(`FAIL ${scenarioId}: missing scenario aggregate`);
      continue;
    }
    const result = validateScenario(scenarioId, aggregate);
    const status = result.passed ? "PASS" : "FAIL";
    console.log(`${status} ${scenarioId}`);
    console.log(
      `  runs=${aggregate.runs}, sdkFreq=${JSON.stringify(aggregate.sdkCallCountFrequency)}, frameworkFreq=${JSON.stringify(aggregate.frameworkCallCountFrequency)}, frameworkNoThinkingFreq=${JSON.stringify(aggregate.frameworkNoThinkingCallCountFrequency)}`,
    );
    if (!result.passed) {
      failed = true;
      for (const reason of result.reasons) {
        console.log(`  - ${reason}`);
      }
    }
  }

  if (failed) {
    process.exitCode = 1;
    console.log("\nGate result: FAIL");
    return;
  }
  console.log("\nGate result: PASS");
}

main();
