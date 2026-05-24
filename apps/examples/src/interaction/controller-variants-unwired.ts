/**
 * Example (xfail): Controller Variants Without Handlers
 *
 * Per HS-116 audit (packages/reactive-intelligence/src/types.ts:181), the
 * ControllerDecision union has 13 variants. As of 2026-05-23, three remain
 * UNWIRED — evaluator exists in `controller/evaluators/*.ts` but NO handler
 * is registered in `defaultInterventionRegistry`:
 *
 *   - `prompt-switch`   (controller/evaluators/prompt-switch.ts)
 *   - `memory-boost`    (controller/evaluators/memory-boost.ts)
 *   - `skill-reinject`  (controller/evaluators/skill-reinject.ts)
 *
 * Each evaluator can emit its decision but the dispatcher rejects with
 * `no-handler` reason — the decision will never reach a handler at runtime.
 *
 * This example asserts those 3 variants ARE missing from the registry. It is
 * flagged xfail because the framework currently leaves them unwired; when a
 * handler is registered for one of them, this example will unexpectedly pass
 * and the xfail flag must be removed (one variant at a time).
 *
 * Note: `human-escalate` is also UNWIRED but is witnessed separately by IX1
 * (hitl-approval-gate) which targets the broader HITL bridge gap.
 *
 * Pass criterion (for xfail accounting): all 3 of these variants still lack a
 * registered handler.
 */

import { defaultInterventionRegistry } from "@reactive-agents/reactive-intelligence";

export interface ExampleResult {
  passed: boolean;
  output: string;
  steps: number;
  tokens: number;
  durationMs: number;
}

const TARGETS = ["prompt-switch", "memory-boost", "skill-reinject"] as const;

export async function run(): Promise<ExampleResult> {
  const start = Date.now();
  console.log("\n=== Controller Variants Still UNWIRED (xfail spec) ===\n");

  const registered = new Set(defaultInterventionRegistry.map((h: { type: string }) => h.type));
  const wired: string[] = [];
  const unwired: string[] = [];

  for (const t of TARGETS) {
    if (registered.has(t)) {
      wired.push(t);
    } else {
      unwired.push(t);
    }
  }

  console.log(`  default registry has ${defaultInterventionRegistry.length} handlers.`);
  console.log(`  unwired (gap remains): [${unwired.join(", ")}]`);
  console.log(`  wired (closed!): [${wired.join(", ")}]`);

  // "passed" here means: every targeted variant has shipped a handler. Today
  // that should be false (all 3 unwired). When the framework lands a handler,
  // this example unexpectedly passes and we must drop the xfail flag for the
  // one(s) that closed and tighten the witness to the still-open subset.
  const passed = unwired.length === 0;
  return {
    passed,
    output: passed
      ? `All 3 previously-UNWIRED controller variants now have handlers — wired: ${wired.join(", ")}. Drop expectsFail flag and split off any still-open variants into their own witness.`
      : `${unwired.length}/3 controller variant(s) still UNWIRED — evaluator exists, no handler in defaultInterventionRegistry: ${unwired.join(", ")}. Each must register a handler in packages/reactive-intelligence/src/controller/handlers/index.ts OR be deleted.`,
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
