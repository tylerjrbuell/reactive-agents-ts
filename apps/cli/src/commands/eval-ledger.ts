// File: apps/cli/src/commands/eval-ledger.ts
import { fail } from "../ui.js";

const DEFAULT_LEDGER_PATH = "wiki/Research/Harness-Reports/improvement-ledger.json";
const LEDGER_USAGE = "Usage: rax eval ledger [--path <improvement-ledger.json>]";

export async function runEvalLedger(args: string[]): Promise<void> {
  const get = (flag: string): string | undefined => {
    const i = args.indexOf(flag);
    return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
  };
  if (args.includes("--help")) {
    console.log(LEDGER_USAGE);
    return;
  }
  const path = get("--path") ?? DEFAULT_LEDGER_PATH;

  let benchmarks: typeof import("@reactive-agents/benchmarks");
  try {
    benchmarks = await import("@reactive-agents/benchmarks");
  } catch {
    console.error(
      fail("rax eval ledger requires @reactive-agents/benchmarks, which is only available inside the reactive-agents-ts repo."),
    );
    process.exit(1);
  }
  const { loadLedger, formatLedger } = benchmarks;
  const ledger = await loadLedger(path);
  console.log(formatLedger(ledger));
}
