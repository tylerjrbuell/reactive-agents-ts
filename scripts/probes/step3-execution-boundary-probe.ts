/**
 * Probe for 09-UNIFIED-PROGRAM §6.4 (Step 3b).
 *
 * Re-scoped after source re-read (2026-08-18): approval, healing, and
 * error-recovery guidance are all ALREADY hand-duplicated onto the kernel's
 * parallel-batch loop (act.ts ~558-830) — they are not currently lost, just
 * triple-implemented (the real "boundary multiplicity" cost, not a live
 * defect). The one CONFIRMED, currently-live, config-independent divergence
 * is VerificationResult attachment:
 *
 *   - tool-observe.ts:503-517 (single-call path via executeToolAndObserve):
 *     attaches `verification` to the observation step ONLY when the caller
 *     opts in via `RA_TOOL_OBSERVE_SYMMETRY=1`. Default OFF ⇒ no verification.
 *   - act.ts:806-812 (kernel's own parallel-batch loop): attaches
 *     `verification` UNCONDITIONALLY, every batched call, every run.
 *
 * So whether a tool call's observation carries a structured VerificationResult
 * depends on which of two boundaries executed it — a downstream consumer
 * (Arbitrator, Reflection) sees richer input for a batched call than for a
 * single sequential one, for no principled reason.
 *
 * Method: same tool, same model, two tasks — one that elicits a single call,
 * one that elicits 2+ parallel calls in one turn (native-FC models batch
 * when asked for independent lookups). Inspect
 * `r.metadata.reasoningSteps[].metadata.verification` presence on the
 * resulting observation step(s).
 *
 * Run: bun scripts/probes/step3-execution-boundary-probe.ts
 * Env: MODELS="gpt-4o-mini:openai,qwen3:14b:ollama"
 */
import { ReactiveAgents } from "reactive-agents";
import { Effect } from "effect";

const CELLS = (process.env.MODELS ?? "gpt-4o-mini:openai,qwen3:14b:ollama")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean)
  .map((s) => {
    const [model, provider] = s.split(":");
    return { model, provider: (provider ?? "openai") as "openai" | "ollama" | "anthropic" | "gemini" };
  });

const lookupTool = {
  definition: {
    name: "lookup_value",
    description: "Look up a numeric value for a given key. Call once per key you need.",
    parameters: [{ name: "key", type: "string", description: "the key to look up", required: true }],
    riskLevel: "low" as const,
    timeoutMs: 5000,
    requiresApproval: false,
    source: "function" as const,
  },
  handler: (args: Record<string, unknown>) =>
    Effect.succeed({ key: args.key, value: String(args.key ?? "").length * 7 }),
};

type StepLike = { type: string; metadata?: Record<string, unknown> };

function verificationFlags(steps: readonly StepLike[]): boolean[] {
  return steps
    .filter((s) => s.type === "observation")
    .map((s) => s.metadata?.verification !== undefined);
}

async function runOne(model: string, provider: string, task: string): Promise<{ callCount: number; verFlags: boolean[]; success: boolean }> {
  const modelCfg = provider === "ollama" ? { model, numCtx: 12000 } : { model };
  const b = ReactiveAgents.create()
    .withPersona({ role: "Agent", background: "", instructions: "Use the provided tools to solve your task.", tone: "concise" })
    .withProvider(provider as "openai" | "ollama")
    .withModel(modelCfg)
    .withReasoning({ defaultStrategy: "reactive", enableStrategySwitching: false })
    .withTools({ tools: [lookupTool], allowedTools: ["lookup_value"], metaTools: false });

  const agent = await b.withObservability({ verbosity: "warn", live: false }).build();
  try {
    const r = await agent.run(task);
    const steps = (r.metadata as Record<string, unknown>).reasoningSteps as readonly StepLike[] | undefined;
    const toolCalls = (r.metadata.toolCalls ?? []) as unknown[];
    return { callCount: toolCalls.length, verFlags: verificationFlags(steps ?? []), success: r.success };
  } finally {
    await agent.dispose();
  }
}

const SINGLE_TASK = "Call lookup_value with key='alpha', report the value, then finish. Make exactly one tool call.";
const PARALLEL_TASK =
  "Call lookup_value for keys 'alpha', 'beta', and 'gamma' — issue all three tool calls together in the same turn (not one at a time), then report all three values and finish.";

const results: Record<string, unknown> = {};
for (const { model, provider } of CELLS) {
  process.stderr.write(`\n[${provider}/${model}] single... `);
  const single = await runOne(model, provider, SINGLE_TASK);
  process.stderr.write(`${JSON.stringify(single)}\n[${provider}/${model}] parallel... `);
  const parallel = await runOne(model, provider, PARALLEL_TASK);
  process.stderr.write(`${JSON.stringify(parallel)}\n`);
  results[`${provider}/${model}`] = { single, parallel };
}
console.log("STEP3_EXECUTION_BOUNDARY_RESULTS=" + JSON.stringify(results, null, 2));
