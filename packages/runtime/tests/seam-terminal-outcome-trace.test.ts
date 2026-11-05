// Run: bun test packages/runtime/tests/seam-terminal-outcome-trace.test.ts --timeout 20000
//
// Plan 8 K1 publisher wiring — "wire it AND pin it".
//
// The kernel mints ONE reconciled TerminalOutcome (`metadata.extensions.terminalOutcome`);
// packages/trace accepts `run-completed.outcome` and `run-started.config.posture`.
// These pins prove the RUNTIME publishes both through a scripted run and that the
// success bit consumes the outcome.
//
// RED-ON-CUT:
//  - drop the `outcome` spread in engine/finalize/run-finalize.ts -> cells 1+2 red.
//  - drop the `posture` spread in engine/execute-agent-started.ts -> cell 3 red.
//  - drop the K1 veto block in engine/execute-success-invariants.ts -> cell 4 red.
//  - drop only its `verdict?.accepted === false` disjunct -> the strategy-shape
//    (no kernelIteration) refused cell red.
import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ReactiveAgents } from "../src/builder.js";
import { deriveExecutionSuccess } from "../src/engine/execute-success-invariants.js";
import { readTerminalOutcome } from "../src/engine/finalize/terminal-outcome-read.js";
import { PARTIAL_SUBSTANTIVE_OUTPUT, PARTIAL_TOLERANCE_MARKER } from "../src/engine/finalize/status-authority.js";
import type { ExecutionContext } from "../src/types.js";
import { makeExecutionContext, makeRuntimeConfig, makeTask } from "../src/testing/index.js";

type Row = {
  kind?: string;
  status?: string;
  config?: { posture?: string };
  outcome?: { status: string; success: boolean; terminatedBy: string | null; verdict: { accepted: boolean } | null };
};

async function readTrace(dir: string): Promise<Row[]> {
  const rows: Row[] = [];
  for (const name of await readdir(dir)) {
    if (!name.endsWith(".jsonl")) continue;
    for (const line of (await readFile(join(dir, name), "utf8")).split("\n")) {
      if (line.trim()) rows.push(JSON.parse(line));
    }
  }
  return rows;
}

const gatherTool = {
  definition: {
    name: "gather",
    description: "gather research data",
    parameters: [{ name: "q", type: "string" as const, description: "query", required: true }],
    riskLevel: "low" as const,
    timeoutMs: 5_000,
    requiresApproval: false,
    source: "function" as const,
  },
  handler: () => Effect.succeed("KEY FACT: the core metric rose 12% last quarter."),
};

async function runTraced(opts: {
  scenario: unknown[];
  task: string;
  posture?: "plan";
  withGather?: boolean;
}): Promise<{ rows: Row[]; success: boolean }> {
  const dir = await mkdtemp(join(tmpdir(), "ra-k1-outcome-"));
  const agent = await ReactiveAgents.create()
    .withName("k1-outcome")
    .withProvider("test")
    .withModel("test")
    .withTestScenario(opts.scenario as never)
    .withTools(opts.withGather ? { tools: [gatherTool], adaptive: false } : { builtins: [], adaptive: false } as never)
    .withReasoning({ defaultStrategy: "reactive", enableStrategySwitching: false })
    .withMaxIterations(8)
    .withObservability({ tracing: { dir } })
    .build();
  const result = await agent.run(opts.task, opts.posture ? { posture: opts.posture } : undefined);
  await agent.dispose();
  return { rows: await readTrace(dir), success: result.success };
}

describe("seam: run-completed.outcome is published from the strategy result", () => {
  it("clean completion: outcome present, status completed, success true", async () => {
    const { rows, success } = await runTraced({
      scenario: [{ text: "FINAL ANSWER: 4." }],
      task: "What is 2 + 2?",
    });
    const rc = rows.find((r) => r.kind === "run-completed");
    expect(rc?.outcome).toBeDefined();
    expect(rc!.outcome).toMatchObject({ status: "completed", success: true });
    expect(rc!.status).toBe("success");
    expect(success).toBe(true);
  }, 20000);

  it("stall_deliverable shape: outcome.success=false AND the run is a failure end to end", async () => {
    const { rows, success } = await runTraced({
      scenario: [
        ...Array.from({ length: 5 }, () => ({ toolCall: { name: "gather", args: { q: "a" } } })),
        { text: "FINAL ANSWER: unsynthesized guess." },
      ],
      task: "Research the topic and summarize it.",
      withGather: true,
    });
    const rc = rows.find((r) => r.kind === "run-completed");
    // Vacuity guard: the run really took the refused-deliverable path.
    expect(rc?.outcome).toBeDefined();
    expect(rc!.outcome!.terminatedBy).toBe("harness_deliverable");
    expect(rc!.outcome!.verdict?.accepted).toBe(false);
    expect(rc!.outcome!.success).toBe(false);
    expect(rc!.status).toBe("failure");
    expect(success).toBe(false);
  }, 20000);
});

describe("seam: run-started.config.posture", () => {
  it("plan posture turn stamps config.posture === 'plan'; execute turn leaves it absent", async () => {
    const scenario = [{ text: "FINAL ANSWER: 4." }];
    const plan = await runTraced({ scenario, task: "What is 2 + 2?", posture: "plan" });
    const exec = await runTraced({ scenario, task: "What is 2 + 2?" });
    expect(plan.rows.find((r) => r.kind === "run-started")?.config?.posture).toBe("plan");
    const execStarted = exec.rows.find((r) => r.kind === "run-started");
    expect(execStarted).toBeDefined();
    expect(execStarted!.config?.posture).toBeUndefined();
  }, 20000);
});

describe("seam: terminalOutcome is a success veto in deriveExecutionSuccess", () => {
  const outcome = (over: Record<string, unknown>) => ({
    status: "partial",
    terminatedBy: "max_iterations",
    provenance: "model-final",
    verdict: null,
    answerSatisfied: null,
    success: false,
    ...over,
  });
  const derive = (terminalOutcome: unknown) => {
    const ctx = makeExecutionContext();
    const rr: ExecutionContext["metadata"]["reasoningResult"] = {
      status: "partial",
      output: "usable answer",
      metadata: {
        cost: 0,
        tokensUsed: 0,
        stepsCount: 0,
        terminatedBy: "max_iterations",
        extensions: terminalOutcome === undefined ? {} : { terminalOutcome },
      },
    };
    return deriveExecutionSuccess({
      ctx,
      task: makeTask({ id: "t", input: { question: "q" } }),
      config: makeRuntimeConfig(),
      rr,
      hasSubstantiveOutput: true,
      outputForSuccess: "usable answer",
    }).executionSucceeded;
  };

  it("refused verdict with no outstandingCriteria still vetoes (RED-ON-CUT target)", () => {
    expect(derive(outcome({ verdict: { accepted: false, summary: "blocked" } }))).toBe(false);
    expect(derive(outcome({ answerSatisfied: false }))).toBe(false);
  });

  it("honest partial (no refusal) keeps the tolerance lane; absent/malformed outcome is inert", () => {
    expect(derive(outcome({}))).toBe(true);
    expect(derive(undefined)).toBe(true);
    expect(derive({ status: "nonsense" })).toBe(true);
  });

  // D9 P5: strategy-owned terminals (plan-execute today; blueprint/code-action/
  // ToT next) now mint a REAL delivery verdict through finalizeStrategyResult.
  // Their result carries no kernel pass: `extensions` has `terminalOutcome`
  // but NO `kernelIteration`, the outcome has `deliverable`/`verifierVerdict`
  // from the strategy's own delivery decision, and `rr.metadata` carries no
  // `outstandingCriteria` (so the W5 veto cannot be what refuses it; the K1
  // verdict check alone must). RED-ON-CUT: delete the
  // `reconciled.verdict?.accepted === false ||` disjunct -> the refused pin
  // goes red.
  const deriveStrategy = (terminalOutcome: Record<string, unknown>) => {
    const ctx = makeExecutionContext();
    const rr: ExecutionContext["metadata"]["reasoningResult"] = {
      status: "partial",
      output: "plan step results, synthesized",
      metadata: {
        cost: 0,
        tokensUsed: 0,
        stepsCount: 4,
        terminatedBy: "end_turn",
        extensions: { terminalOutcome },
      },
    };
    const succeeded = deriveExecutionSuccess({
      ctx,
      task: makeTask({ id: "t", input: { question: "q" } }),
      config: makeRuntimeConfig(),
      rr,
      hasSubstantiveOutput: true,
      outputForSuccess: "plan step results, synthesized",
    }).executionSucceeded;
    return { succeeded, ctx, rr };
  };
  const strategyOutcome = (over: Record<string, unknown>) => ({
    status: "partial",
    terminatedBy: "end_turn",
    provenance: "model-final",
    verdict: null,
    answerSatisfied: null,
    success: false,
    authority: "strategy",
    deliverable: null,
    verifierVerdict: null,
    outstanding: [],
    ...over,
  });

  it("strategy shape: refused delivery verdict on a partial is NOT success (RED-ON-CUT target)", () => {
    const { succeeded, ctx, rr } = deriveStrategy(
      strategyOutcome({
        verdict: { accepted: false, summary: "deliverable not grounded" },
        deliverable: { outcome: "block", reason: "deliverable not grounded", accepted: false },
        verifierVerdict: { verified: false, failedChecks: ["grounded"] },
        outstanding: ["grounded"],
      }),
    );
    // Vacuity guards: genuinely the kernel-meta-less shape, and only K1 can veto.
    expect(rr?.metadata?.extensions?.["kernelIteration"]).toBeUndefined();
    expect(rr?.metadata?.outstandingCriteria).toBeUndefined();
    expect(succeeded).toBe(false);
    expect(ctx.metadata.terminalOutcomeNotSuccess).toBe(true);
  });

  it("strategy shape: accepted delivery verdict on a partial stays tolerated", () => {
    const { succeeded, ctx } = deriveStrategy(
      strategyOutcome({
        verdict: { accepted: true, summary: "delivered" },
        deliverable: { outcome: "pass", reason: "delivered", accepted: true },
        verifierVerdict: { verified: true, failedChecks: [] },
      }),
    );
    expect(succeeded).toBe(true);
    expect(ctx.metadata.terminalOutcomeNotSuccess).toBeUndefined();
    expect(ctx.metadata[PARTIAL_TOLERANCE_MARKER]).toBe(PARTIAL_SUBSTANTIVE_OUTPUT);
  });

  it("strategy shape: null verdict (unjudged strategy) on a partial stays tolerated", () => {
    const { succeeded, ctx } = deriveStrategy(strategyOutcome({}));
    expect(succeeded).toBe(true);
    expect(ctx.metadata.terminalOutcomeNotSuccess).toBeUndefined();
    expect(ctx.metadata[PARTIAL_TOLERANCE_MARKER]).toBe(PARTIAL_SUBSTANTIVE_OUTPUT);
  });

  it("readTerminalOutcome rejects malformed slots without throwing", () => {
    expect(readTerminalOutcome(undefined)).toBeUndefined();
    expect(readTerminalOutcome({ extensions: { terminalOutcome: "x" } })).toBeUndefined();
    expect(readTerminalOutcome({ extensions: { terminalOutcome: outcome({}) } })?.status).toBe("partial");
  });
});
