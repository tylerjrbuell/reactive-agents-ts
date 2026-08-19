/**
 * Probe for 09-UNIFIED-PROGRAM §6.5 (Step 3c).
 *
 * Claim under test: the kernel's terminal gate treats a required tool as
 * "covered" the moment it is ATTEMPTED (`newToolsUsed.add(...)` fires before
 * execution in act.ts, then `arbitrator.ts` passes `coveredTools:
 * ctx.toolsUsed` straight to `evaluateTerminalGate`) — so a required tool
 * that is called and FAILS still satisfies the requirement.
 *
 * Method: a single required tool whose handler always fails. If the harness
 * is behaving as claimed, the run should end with the requirement ledger
 * entry showing "satisfied" (or the run reporting overall success / no
 * missing-requirement redirect) despite the tool having failed every time —
 * that's the bug. A correct implementation would show the requirement
 * unsatisfied and the run either abstaining or explicitly failing on
 * missing-coverage grounds, not on an unrelated ambiguity.
 *
 * Run: bun scripts/probes/step3-requirement-evidence-probe.ts
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

let callCount = 0;
const alwaysFailTool = {
  definition: {
    name: "record_finding",
    description: "Records a finding. MUST be called before finishing.",
    parameters: [{ name: "finding", type: "string", description: "the finding text", required: true }],
    riskLevel: "low" as const,
    timeoutMs: 5000,
    requiresApproval: false,
    source: "function" as const,
  },
  handler: (_args: Record<string, unknown>) => {
    callCount++;
    return Effect.fail(new Error("record_finding: backend unavailable (probe injected failure)"));
  },
};

async function runCell(model: string, provider: string): Promise<Record<string, unknown>> {
  callCount = 0;
  const modelCfg = provider === "ollama" ? { model, numCtx: 12000 } : { model };
  const b = ReactiveAgents.create()
    .withPersona({ role: "Agent", background: "", instructions: "Use the provided tools to solve your task.", tone: "concise" })
    .withProvider(provider as "openai" | "ollama")
    .withModel(modelCfg)
    .withReasoning({ defaultStrategy: "reactive", enableStrategySwitching: false })
    .withTools({ tools: [alwaysFailTool], allowedTools: ["record_finding"], metaTools: false })
    .withRequiredTools({ tools: ["record_finding"], maxRetries: 1 });

  const task = "Call record_finding with finding='probe test', then report the outcome and finish.";

  try {
    const agent = await b.withObservability({ verbosity: "warn", live: false }).build();
    try {
      const r = await agent.run(task);
      const ledger = (r.metadata as Record<string, unknown>).runLedger as
        | ReadonlyArray<Record<string, unknown>>
        | undefined;
      const reqEntries = (ledger ?? []).filter((e) => e.kind === "requirement");
      return {
        toolCallAttempts: callCount,
        runSuccess: r.success,
        requirementLedgerEntries: reqEntries,
        verdict: (r.metadata as Record<string, unknown>).verdict,
      };
    } finally {
      await agent.dispose();
    }
  } catch (e) {
    return { error: String(e) };
  }
}

const results: Record<string, Record<string, unknown>> = {};
for (const { model, provider } of CELLS) {
  process.stderr.write(`\n[${provider}/${model}] running... `);
  const r = await runCell(model, provider);
  results[`${provider}/${model}`] = r;
  process.stderr.write(`${JSON.stringify(r)}\n`);
}
console.log("STEP3_REQUIREMENT_EVIDENCE_RESULTS=" + JSON.stringify(results, null, 2));
