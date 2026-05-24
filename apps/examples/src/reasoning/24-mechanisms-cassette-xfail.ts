/**
 * Example (xfail): Mechanisms Awaiting Cassette Infrastructure
 *
 * A combined xfail witness for 4 mechanisms whose firing requires
 * real-LLM behavior the deterministic test provider cannot reproduce:
 *
 *   - M3 Verifier+Retry — needs a failure-then-success cassette
 *   - M7 Calibration    — needs entropy-history accumulation across runs
 *   - M9 Termination Oracle (focused) — needs every termination path to
 *     route through `kernel/loop/terminate.ts:terminate()` and the
 *     reason code surface to be enumerable
 *   - M12 Provider Adapters (matrix) — only 2 of 6 adapters can run
 *     under offline mode (ollama needs a server; anthropic/openai/gemini
 *     need API keys; litellm needs a proxy)
 *
 * Each assertion below is the "spec" — when the cassette/replay
 * infrastructure makes the mechanism witnessable offline, drop that
 * assertion AND the xfail flag for this row (or split into a focused
 * passing witness).
 */

import { defaultReactiveIntelligenceConfig } from "@reactive-agents/reactive-intelligence";

export interface ExampleResult {
  passed: boolean;
  output: string;
  steps: number;
  tokens: number;
  durationMs: number;
}

export async function run(): Promise<ExampleResult> {
  const start = Date.now();
  console.log("\n=== Mechanisms Awaiting Cassette Infrastructure (xfail spec) ===\n");

  const findings: string[] = [];

  // M3: cassette infrastructure check. A passing witness would replay a
  // recorded run where the verifier rejects the first attempt and the
  // healing/retry path produces a corrected answer.
  const m3CassettePresent = false;  // no cassette runner today
  if (!m3CassettePresent) {
    findings.push("M3 verifier+retry: no failure-then-success cassette available; @reactive-agents/replay supports identity replay only");
  }

  // M7: calibration. defaultReactiveIntelligenceConfig has calibrationDbPath
  // but no example currently triggers calibration sample accumulation.
  const m7Wired = typeof defaultReactiveIntelligenceConfig?.calibrationDbPath === "string";
  if (m7Wired) {
    findings.push(`M7 calibration: config wired (calibrationDbPath="${defaultReactiveIntelligenceConfig.calibrationDbPath}") but no run accumulates samples; needs a multi-iteration cassette under a calibrated model`);
  } else {
    findings.push("M7 calibration: not wired in defaultReactiveIntelligenceConfig");
  }

  // M9: termination oracle focused witness. The framework asserts every
  // termination flows through kernel/loop/terminate.ts:terminate() (W4
  // single-owner), but the reason-code surface is not enumerated as a
  // closed union for examples to assert against.
  findings.push("M9 termination oracle: no enumerable reason-code union exported; live runs surface divergent reason codes (final_answer vs final_answer_tool — see COVERAGE.md L3)");

  // M12: provider adapter matrix. 6 adapters declared, only 'test' and
  // 'ollama' exercised offline. A passing witness would run a small task
  // through each adapter with a recorded cassette.
  findings.push("M12 provider adapters: offline matrix covers 2/6 (test, ollama). anthropic/openai/gemini/litellm require API keys or proxies; needs cassette-driven adapter probes");

  console.log("  spec findings:");
  for (const f of findings) console.log("    - " + f);

  // Pass criterion (for xfail accounting): all 4 mechanisms still lack an
  // offline cassette-driven witness. When any one ships, drop that finding
  // and split off a passing witness for it.
  const passed = findings.length === 0;
  return {
    passed,
    output: passed
      ? "All 4 cassette-blocked mechanisms now have offline witnesses — drop expectsFail flag and split each into its own focused witness."
      : `${findings.length} mechanism(s) await cassette infrastructure: M3, M7, M9, M12.`,
    steps: 1,
    tokens: 0,
    durationMs: Date.now() - start,
  };
}

if (import.meta.main) {
  const r = await run();
  console.log(r.passed ? "\n✅ PASS" : "\n❌ FAIL", r.output);
  process.exit(r.passed ? 0 : 1);
}
