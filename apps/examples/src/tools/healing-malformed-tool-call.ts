/**
 * Example: Healing Pipeline — M4 Live Witness
 *
 * Witnesses the M4 healing pipeline (Phase 1 KEEP verdict: 86.7% recovery
 * rate, +80pp accuracy lift, 10:1 token ROI) by feeding a malformed tool
 * call through `runHealingPipeline` and asserting the canonical recovery
 * paths fire.
 *
 * Two witnesses:
 *
 *   1. **Direct witness (deterministic):** import `runHealingPipeline` from
 *      `@reactive-agents/tools` and feed it three malformed call shapes —
 *      a numeric type coercion (`"5"` → `5`), a fuzzy parameter-name match
 *      (`fistNum` → `firstNum`), and an unrecognized tool name (which
 *      MUST fail healing). Assert the pipeline emits the expected
 *      HealingAction entries and that `succeeded` flips correctly.
 *
 *   2. **In-loop witness (best-effort):** build a real agent with an `add`
 *      tool and a test scenario emitting a malformed `toolCall`. Tap the
 *      `observation.tool-result` Compose tag (act.ts:922) which carries
 *      `ctx.healed: boolean`. Report whether the live path fired.
 *
 * Documented limitation: under the test provider the streaming tool-call
 * path doesn't always dispatch through the act phase (the runner currently
 * favors the first text turn), so the in-loop witness is informational
 * only — the direct witness is the gate.
 *
 * Usage:
 *   bun run apps/examples/src/tools/healing-malformed-tool-call.ts
 */

import { ReactiveAgents } from "reactive-agents";
import type { Harness } from "@reactive-agents/core";
import { runHealingPipeline } from "@reactive-agents/tools";
import { Effect } from "effect";

export interface ExampleResult {
  passed: boolean;
  output: string;
  steps: number;
  tokens: number;
  durationMs: number;
}

export async function run(opts?: { provider?: string; model?: string }): Promise<ExampleResult> {
  const start = Date.now();

  type PN = "anthropic" | "openai" | "ollama" | "gemini" | "litellm" | "test";
  const provider = (opts?.provider ?? (process.env.ANTHROPIC_API_KEY ? "anthropic" : "test")) as PN;

  console.log("\n=== Healing Pipeline Live Witness (M4) ===");
  console.log(`Mode: ${provider !== "test" ? `LIVE (${provider})` : "TEST"}\n`);

  // ─── 1. Direct witness — exercise runHealingPipeline three ways ─────────
  const addSchema = {
    name: "add",
    description: "Add two numbers and return their sum.",
    parameters: [
      { name: "a", type: "number", required: true },
      { name: "b", type: "number", required: true },
    ],
  };
  const otherSchema = {
    name: "concat",
    description: "Concatenate two strings.",
    parameters: [
      { name: "firstNum", type: "string", required: true },
      { name: "second", type: "string", required: true },
    ],
  };
  const schemas = [addSchema, otherSchema];

  // (a) Type coercion: "5" (string) → 5 (number).
  const coercionCase = runHealingPipeline(
    { id: "c-1", name: "add", arguments: { a: "5", b: 3 } },
    schemas,
    new Set<string>(),
    process.cwd(),
    {},
    {},
  );
  const coercedAction = coercionCase.actions.find((a) => a.stage === "type-coerce");
  const aAfter = coercionCase.call.arguments.a;
  console.log("Case 1 — TypeCoercer (string → number):");
  console.log(`  pre: { a: "5", b: 3 }   post: ${JSON.stringify(coercionCase.call.arguments)}`);
  console.log(`  succeeded=${coercionCase.succeeded} actions=${coercionCase.actions.length}`);
  console.log(`  type-coerce fired: ${Boolean(coercedAction)} (a is now ${typeof aAfter})`);

  // (b) Param-name healer: fistNum → firstNum (edit distance 1).
  const paramCase = runHealingPipeline(
    { id: "c-2", name: "concat", arguments: { fistNum: "hello", second: "world" } },
    schemas,
    new Set<string>(),
    process.cwd(),
    {},
    {},
  );
  const paramAction = paramCase.actions.find((a) => a.stage === "param-name");
  console.log("\nCase 2 — ParamNameHealer (fistNum → firstNum):");
  console.log(`  pre: { fistNum: "hello", second: "world" }`);
  console.log(`  post: ${JSON.stringify(paramCase.call.arguments)}`);
  console.log(`  param-name fired: ${Boolean(paramAction)} succeeded=${paramCase.succeeded}`);

  // (c) Unrecognized tool — healer MUST fail.
  const failCase = runHealingPipeline(
    { id: "c-3", name: "totally-unknown-tool", arguments: { foo: "bar" } },
    schemas,
    new Set<string>(),
    process.cwd(),
    {},
    {},
  );
  console.log("\nCase 3 — Unrecognized tool (must fail):");
  console.log(`  succeeded=${failCase.succeeded} actions=${failCase.actions.length}`);

  const directWitnessPassed =
    Boolean(coercedAction) &&
    typeof aAfter === "number" &&
    Boolean(paramAction) &&
    paramCase.succeeded &&
    failCase.succeeded === false;

  // ─── 2. In-loop witness — try to fire the live path via the agent ───────
  type HealEvent = { iter: number; toolName: string; healed: boolean; callId: string };
  const observedToolResults: HealEvent[] = [];
  let healingFailureFired = false;

  const witnessHarness = (h: Harness) => {
    h.tap("observation.tool-result", (_payload, ctx) => {
      observedToolResults.push({
        iter: ctx.iteration,
        toolName: ctx.toolName,
        healed: ctx.healed,
        callId: ctx.callId,
      });
      if (ctx.healed) {
        console.log(
          `  [M4 HEALED in-loop] tool=${ctx.toolName} callId=${ctx.callId} iter=${ctx.iteration}`,
        );
      }
    });
    h.tap("nudge.healing-failure", (payload, ctx) => {
      healingFailureFired = true;
      console.log(`  [healing-failure] iter=${ctx.iteration}: ${payload}`);
    });
  };

  const addTool = {
    definition: {
      name: "add",
      description: "Add two numbers and return their sum.",
      parameters: [
        { name: "a", type: "number" as const, description: "First number", required: true },
        { name: "b", type: "number" as const, description: "Second number", required: true },
      ],
      riskLevel: "low" as const,
      timeoutMs: 5_000,
      requiresApproval: false,
      source: "function" as const,
    },
    handler: (args: Record<string, unknown>) =>
      Effect.succeed(`add(${args.a}, ${args.b}) = ${Number(args.a) + Number(args.b)}`),
  };

  let b = ReactiveAgents.create()
    .withName("m4-healing-witness")
    .withProvider(provider);
  if (opts?.model) b = b.withModel(opts.model);
  b = b
    .withReasoning({ defaultStrategy: "reactive" })
    .withTools({ tools: [addTool] as never })
    .withMaxIterations(4)
    .withHarness(witnessHarness);

  if (provider === "test") {
    b = b.withTestScenario([
      {
        toolCall: {
          name: "add",
          args: { a: "5", b: 3 },
          id: "call-malformed-1",
        },
      },
      { text: "FINAL ANSWER: 5 + 3 = 8 (computed via the healed add tool call)." },
    ]);
  }

  const agent = await b.build();
  const result = await agent.run("Compute 5 + 3 using the add tool.");
  await agent.dispose();

  const healedResults = observedToolResults.filter((e) => e.healed);
  console.log(`\nAgent output: ${result.output.slice(0, 200)}`);
  console.log(`Steps: ${result.metadata.stepsCount}`);
  console.log(`In-loop tool-result observations: ${observedToolResults.length}`);
  console.log(`In-loop healed=true observations: ${healedResults.length}`);
  console.log(`In-loop healing-failure fired: ${healingFailureFired}`);
  if (observedToolResults.length === 0) {
    console.log(
      "  (note: in-loop tool dispatch did not fire under the test provider —\n" +
        "   the streaming toolCall path is not wired to the act phase in this\n" +
        "   harness. Direct witness above is the canonical M4 gate; Phase 2\n" +
        "   will re-witness with a cassette replay from a real model run.)",
    );
  }

  // Pass criterion: the direct witness MUST pass. The agent run must also
  // succeed but its tool-dispatch observations are informational.
  const passed = directWitnessPassed && result.success;

  return {
    passed,
    output:
      `m4-witness: direct=[coerce:${Boolean(coercedAction)},param:${Boolean(paramAction)},fail-correctly:${!failCase.succeeded}] ` +
      `in-loop=${healedResults.length}/${observedToolResults.length} | ${result.output.slice(0, 60)}`,
    steps: result.metadata.stepsCount,
    tokens: result.metadata.tokensUsed,
    durationMs: Date.now() - start,
  };
}

if (import.meta.main) {
  run()
    .then((r) => {
      console.log("\n---");
      console.log(r.passed ? "PASSED" : "FAILED", `(${r.durationMs}ms)`);
      console.log(JSON.stringify(r, null, 2));
      process.exit(r.passed ? 0 : 1);
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
