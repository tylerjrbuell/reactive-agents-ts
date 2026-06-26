// File: apps/cli/src/commands/eval-gate.ts
import type { GateVerdict, LiftPolicy } from "@reactive-agents/benchmarks";
import { fail, info } from "../ui.js";

const GATE_USAGE =
  "Usage: rax eval gate --report <SessionReport.json> --baseline <variantId> --candidate <variantId> " +
  "[--metric <dimension>] [--min-lift <pp>] [--max-tok <pct>] [--min-tiers <n>]";

/**
 * Pure exit-code mapping for a gate verdict.
 * reject → 1 (CI must block); no comparable tiers → 2 (bad variant ids / empty data);
 * default-on / opt-in → 0.
 */
export function decideExitCode(verdict: GateVerdict): number {
  if (verdict.aggregate.tiersCovered === 0) return 2;
  if (verdict.decision === "reject") return 1;
  return 0;
}

export async function runEvalGate(args: string[]): Promise<void> {
  const get = (flag: string): string | undefined => {
    const i = args.indexOf(flag);
    return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
  };

  const reportPath = get("--report");
  const baseline = get("--baseline");
  const candidate = get("--candidate");
  if (!reportPath || !baseline || !candidate) {
    console.error(fail(GATE_USAGE));
    process.exit(1);
  }

  let benchmarks: typeof import("@reactive-agents/benchmarks");
  try {
    benchmarks = await import("@reactive-agents/benchmarks");
  } catch {
    console.error(
      fail(
        "rax eval gate requires @reactive-agents/benchmarks, which is only available inside the reactive-agents-ts repo.",
      ),
    );
    process.exit(1);
  }
  const { evaluateLiftGate, formatGateReceipt, DEFAULT_LIFT_POLICY } = benchmarks;

  let reportText: string;
  try {
    reportText = await Bun.file(reportPath).text();
  } catch {
    console.error(fail(`Cannot read report file: ${reportPath}`));
    process.exit(1);
  }

  let report: unknown;
  try {
    report = JSON.parse(reportText);
  } catch {
    console.error(fail(`Invalid JSON in report file: ${reportPath}`));
    process.exit(1);
  }

  const policy: LiftPolicy = {
    ...DEFAULT_LIFT_POLICY,
    ...(get("--metric") ? { metric: get("--metric") as LiftPolicy["metric"] } : {}),
    ...(get("--min-lift") ? { minLiftPp: Number(get("--min-lift")) } : {}),
    ...(get("--max-tok") ? { maxTokenOverheadPct: Number(get("--max-tok")) } : {}),
    ...(get("--min-tiers") ? { minTiers: Number(get("--min-tiers")) } : {}),
  };

  // evaluateLiftGate is pure; report shape is the SessionReport written by `rax bench --output`.
  const verdict = evaluateLiftGate(report as Parameters<typeof evaluateLiftGate>[0], baseline, candidate, policy);
  console.log(formatGateReceipt(verdict));
  if (verdict.aggregate.tiersCovered === 0) {
    console.error(
      info(`No comparable tiers for "${baseline}" vs "${candidate}" — check the variant ids exist in the report.`),
    );
  }
  process.exit(decideExitCode(verdict));
}
