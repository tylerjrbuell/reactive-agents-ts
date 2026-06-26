// File: apps/cli/src/commands/eval-gate.ts
import type { GateVerdict, LiftPolicy } from "@reactive-agents/benchmarks";
import { fail, info } from "../ui.js";

const GATE_USAGE =
  "Usage: rax eval gate --report <SessionReport.json> --baseline <variantId> --candidate <variantId> " +
  "[--metric <dimension>] [--min-lift <pp>] [--max-tok <pct>] [--min-tiers <n>] " +
  "[--ledger <path> --weakness <t> --hypothesis <t> --weakness-ref <id>]";

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

  const num = (flag: string): number | undefined => {
    const raw = get(flag);
    if (raw === undefined) return undefined;
    const n = Number(raw);
    if (Number.isNaN(n)) {
      console.error(fail(`${flag} must be a number, got "${raw}"`));
      process.exit(1);
    }
    return n;
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
  const { evaluateLiftGate, formatGateReceipt, DEFAULT_LIFT_POLICY, recordGateOutcome, loadLedger, saveLedger } =
    benchmarks;

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

  const minLift = num("--min-lift");
  const maxTok = num("--max-tok");
  const minTiers = num("--min-tiers");
  const policy: LiftPolicy = {
    ...DEFAULT_LIFT_POLICY,
    ...(get("--metric") ? { metric: get("--metric") as LiftPolicy["metric"] } : {}),
    ...(minLift !== undefined ? { minLiftPp: minLift } : {}),
    ...(maxTok !== undefined ? { maxTokenOverheadPct: maxTok } : {}),
    ...(minTiers !== undefined ? { minTiers } : {}),
  };

  // evaluateLiftGate is pure; report shape is the SessionReport written by `rax bench --output`.
  const verdict = evaluateLiftGate(report as Parameters<typeof evaluateLiftGate>[0], baseline, candidate, policy);
  console.log(formatGateReceipt(verdict));
  if (verdict.aggregate.tiersCovered === 0) {
    console.error(
      info(`No comparable tiers for "${baseline}" vs "${candidate}" — check the variant ids exist in the report.`),
    );
  }
  const ledgerPath = get("--ledger");
  if (ledgerPath) {
    const ledger = await loadLedger(ledgerPath);
    const updated = recordGateOutcome(ledger, {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      weakness: get("--weakness") ?? `${candidate} vs ${baseline}`,
      ...(get("--weakness-ref") ? { weaknessRef: get("--weakness-ref") as string } : {}),
      hypothesis: get("--hypothesis") ?? candidate,
      metric: policy.metric,
      verdict,
    });
    await saveLedger(ledgerPath, updated);
    console.log(info(`Recorded to improvement ledger: ${ledgerPath} (${updated.entries.length} entries)`));
  }
  process.exit(decideExitCode(verdict));
}
