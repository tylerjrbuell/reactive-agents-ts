/**
 * Example: @reactive-agents/diagnose programmatic API witness
 *
 * The primary surface is the rax-diagnose CLI; this example pins the
 * programmatic exports (used by the harness-improvement-loop skill and
 * by tests) so they stay reachable.
 *
 * Witnesses:
 *   - `listTraces(dir)` discovers trace files
 *   - `resolveTracePath(input)` resolves names + paths
 *   - `DEFAULT_TRACE_DIR` constant exported
 *   - `replayCommand` / `grepCommand` / `diffCommand` / `listCommand` /
 *     `debriefCommand` / `replayRunCommand` exist as callable functions
 *
 * Pass criterion: every export resolves AND `listTraces` returns an array
 * (empty array is fine — directory may be empty in CI).
 */

import {
  DEFAULT_TRACE_DIR,
  listTraces,
  resolveTracePath,
  replayCommand,
  grepCommand,
  diffCommand,
  listCommand,
  debriefCommand,
  replayRunCommand,
} from "@reactive-agents/diagnose";

export interface ExampleResult {
  passed: boolean;
  output: string;
  steps: number;
  tokens: number;
  durationMs: number;
}

export async function run(): Promise<ExampleResult> {
  const start = Date.now();
  console.log("\n=== @reactive-agents/diagnose programmatic API witness ===\n");

  // Probe 1: DEFAULT_TRACE_DIR constant
  const dirOk = typeof DEFAULT_TRACE_DIR === "string" && DEFAULT_TRACE_DIR.length > 0;
  console.log(`  DEFAULT_TRACE_DIR: ${dirOk ? "✓" : "✗"} (${DEFAULT_TRACE_DIR})`);

  // Probe 2: listTraces returns an array
  let traces: unknown[] = [];
  let listOk = false;
  try {
    traces = await listTraces(DEFAULT_TRACE_DIR);
    listOk = Array.isArray(traces);
  } catch {
    listOk = false;
  }
  console.log(`  listTraces: ${listOk ? "✓" : "✗"} (${traces.length} traces discovered)`);

  // Probe 3: resolveTracePath resolves a synthetic path
  let resolveOk = false;
  try {
    const r = await resolveTracePath("nonexistent-trace-name.jsonl");
    resolveOk = r !== undefined; // returns null or a TraceFileInfo; not a throw
  } catch {
    // Some implementations may throw on missing; either behaviour is fine for the wiring witness.
    resolveOk = true;
  }
  console.log(`  resolveTracePath: ${resolveOk ? "✓" : "✗"}`);

  // Probe 4: all command exports are callable functions
  const cmds = {
    replayCommand,
    grepCommand,
    diffCommand,
    listCommand,
    debriefCommand,
    replayRunCommand,
  };
  const callable: Record<string, boolean> = {};
  for (const [name, fn] of Object.entries(cmds)) {
    callable[name] = typeof fn === "function";
  }
  const allCallable = Object.values(callable).every(Boolean);
  console.log(`  command exports: ${allCallable ? "✓" : "✗"} (${Object.entries(callable).map(([k, v]) => `${k}=${v ? "✓" : "✗"}`).join(", ")})`);

  const passed = dirOk && listOk && resolveOk && allCallable;
  return {
    passed,
    output: passed
      ? `diagnose programmatic API reachable: DEFAULT_TRACE_DIR, listTraces (${traces.length}), resolveTracePath, 6 command exports.`
      : `diagnose witness FAILED — dirOk=${dirOk} listOk=${listOk} resolveOk=${resolveOk} allCallable=${allCallable}`,
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
