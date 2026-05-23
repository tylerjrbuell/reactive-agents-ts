/**
 * ri-ablation.ts — multi-model RI on/off ablation across failure scenarios.
 *
 * Answers Q1a (does RI fire?) + Q1b (Δ-success when fires?).
 *
 * Per (scenario, model) runs TWO variants: with `.withReactiveIntelligence()`
 * and without. Compares success, tokens, duration, intervention counts.
 *
 * Env:
 *   RI_MODELS   CSV models (default: "cogito:14b,qwen3:14b")
 *   RI_TRACE_DIR (default: .reactive-agents/traces/ri-ablation)
 *
 * Frontier slice (opt-in): RI_FRONTIER=1 appends gpt-4o-mini.
 */

import { ReactiveAgents } from "@reactive-agents/runtime";
import { loadTrace, traceStats } from "@reactive-agents/trace";
import { Effect } from "effect";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const TRACE_DIR = resolve(process.cwd(), process.env.RI_TRACE_DIR ?? ".reactive-agents/traces/ri-ablation");

function alwaysErrorTool(name: string, description: string, errorMsg: string) {
  return {
    definition: {
      name,
      description,
      parameters: [{ name: "input", type: "string" as const, description: "Query", required: false }],
      riskLevel: "low" as const,
      timeoutMs: 3000,
      requiresApproval: false,
      source: "function" as const,
    },
    handler: (_args: Record<string, unknown>) => Effect.die(new Error(errorMsg)),
  };
}

interface Scenario {
  readonly id: string;
  readonly label: "success" | "failure";
  readonly task: string;
  readonly maxIterations: number;
  readonly tools: ReturnType<typeof alwaysErrorTool>[];
}

const SCENARIOS: Scenario[] = [
  // Success baseline — convergence path; RI should NOT fire
  {
    id: "success-capital",
    label: "success",
    task: "What is the capital of France? Just the city name.",
    maxIterations: 4,
    tools: [],
  },
  {
    id: "success-paradigm",
    label: "success",
    task: "What paradigm does TypeScript primarily support? List two features.",
    maxIterations: 4,
    tools: [],
  },
  // Failure tasks — tool errors, RI tool-failure-streak should fire
  {
    id: "failure-rate-limit",
    label: "failure",
    task: "Search the web for the current Bitcoin price. You MUST call web-search on every attempt. Call it at least 6 times before considering alternatives. Do not call final-answer until web-search returns a price.",
    maxIterations: 12,
    tools: [alwaysErrorTool("web-search", "Search the web", "Rate limit exceeded. Retry in 60s.")],
  },
  {
    id: "failure-verify-loop",
    label: "failure",
    task: "Run the test suite using run-tests and fix until all pass. Call run-tests at least 6 times. Do not call final-answer until you see {failed: 0}.",
    maxIterations: 12,
    tools: [alwaysErrorTool("run-tests", "Execute tests", '{"passed": 2, "failed": 3, "errors": ["assert fail 23", "null 41"]}')],
  },
];

interface Cell {
  scenario: string;
  label: string;
  model: string;
  riEnabled: boolean;
  success: boolean;
  iterationsUsed: number | null;
  durationMs: number;
  tokens: number;
  outputLength: number;
  maxEntropy: number;
  interventionsDispatched: number;
  interventionsSuppressed: number;
  outputPreview: string;
  error?: string;
}

async function runCell(scenario: Scenario, model: string, riEnabled: boolean): Promise<Cell> {
  const provider = model.startsWith("gpt-") ? "openai" : "ollama";
  const start = Date.now();

  try {
    let builder = ReactiveAgents.create()
      .withProvider(provider as "ollama" | "openai")
      .withModel({ model })
      .withReasoning({ defaultStrategy: "reactive", maxIterations: scenario.maxIterations })
      .withTools({ tools: scenario.tools })
      .withTracing({ dir: TRACE_DIR });

    // HS-108 / R10: RI is opt-OUT (builder default `_enableReactiveIntelligence`
    // is true at builder.ts:363). Prior code did not call `.withReactiveIntelligence(false)`
    // for the RI-off variant, so RI fired on both arms and contaminated the
    // ablation. Explicit boolean toggle makes the on/off intent unambiguous.
    builder = builder.withReactiveIntelligence(riEnabled);

    const agent = await builder.build();
    const result = await agent.run(scenario.task);
    const durationMs = Date.now() - start;
    await agent.dispose();

    let maxEntropy = 0;
    let interventionsDispatched = 0;
    let interventionsSuppressed = 0;
    let iterations: number | null = null;
    try {
      const trace = await loadTrace(`${TRACE_DIR}/${result.taskId}.jsonl`);
      const s = traceStats(trace);
      maxEntropy = s.maxEntropy;
      interventionsDispatched = s.interventionsDispatched;
      interventionsSuppressed = s.interventionsSuppressed;
      iterations = s.iterations;
    } catch {
      iterations = result.metadata?.stepsCount ?? null;
    }

    return {
      scenario: scenario.id,
      label: scenario.label,
      model,
      riEnabled,
      success: result.success,
      iterationsUsed: iterations,
      durationMs,
      // ResultMetadata schema field is `tokensUsed` (packages/core/src/types/result.ts:38),
      // not `totalTokens`. The `totalTokens` field on AgentCompleted event and on
      // strategy ReasoningResult are separate; ResultMetadata uses `tokensUsed`.
      tokens: result.metadata?.tokensUsed ?? 0,
      outputLength: result.output.length,
      maxEntropy,
      interventionsDispatched,
      interventionsSuppressed,
      outputPreview: result.output.slice(0, 240),
    };
  } catch (err) {
    return {
      scenario: scenario.id,
      label: scenario.label,
      model,
      riEnabled,
      success: false,
      iterationsUsed: null,
      durationMs: Date.now() - start,
      tokens: 0,
      outputLength: 0,
      maxEntropy: 0,
      interventionsDispatched: 0,
      interventionsSuppressed: 0,
      outputPreview: "",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function main(): Promise<void> {
  const models = (process.env.RI_MODELS ?? "cogito:14b,qwen3:14b").split(",").map((s) => s.trim()).filter(Boolean);
  if (process.env.RI_FRONTIER === "1") models.push("gpt-4o-mini");

  mkdirSync(TRACE_DIR, { recursive: true });
  const reportsDir = resolve(process.cwd(), "wiki/Research/Harness-Reports");
  mkdirSync(reportsDir, { recursive: true });

  const totalCells = SCENARIOS.length * models.length * 2;
  console.log(`\nRI Ablation — ${totalCells} cells (${SCENARIOS.length} scenarios × ${models.length} models × {RI-on, RI-off})\n`);

  const cells: Cell[] = [];
  let idx = 0;
  for (const model of models) {
    for (const scenario of SCENARIOS) {
      for (const riEnabled of [false, true]) {
        idx++;
        const label = `${scenario.id} × ${model} × RI-${riEnabled ? "on" : "off"}`;
        process.stdout.write(`[${idx}/${totalCells}] ${label} ... `);
        const cell = await runCell(scenario, model, riEnabled);
        cells.push(cell);
        const tag = cell.error
          ? `ERR ${cell.error.slice(0, 50)}`
          : `${cell.success ? "ok" : "FAIL"} iter=${cell.iterationsUsed} tok=${cell.tokens} disp=${cell.interventionsDispatched} sup=${cell.interventionsSuppressed} ${(cell.durationMs / 1000).toFixed(1)}s`;
        process.stdout.write(`${tag}\n`);
      }
    }
  }

  const ts = new Date().toISOString().slice(0, 16).replace("T", "-");
  const jsonPath = resolve(reportsDir, `ri-ablation-${ts}.json`);
  writeFileSync(jsonPath, JSON.stringify(cells, null, 2));

  // Pairwise diff
  console.log(`\n=== Pairwise (RI-on vs RI-off) ===`);
  const pairs = new Map<string, { off?: Cell; on?: Cell }>();
  for (const c of cells) {
    const key = `${c.model}|${c.scenario}`;
    pairs.set(key, { ...(pairs.get(key) ?? {}), [c.riEnabled ? "on" : "off"]: c });
  }
  for (const [key, p] of pairs) {
    if (!p.off || !p.on) continue;
    const dSuccess = (p.on.success ? 1 : 0) - (p.off.success ? 1 : 0);
    const dTokens = p.on.tokens - p.off.tokens;
    const dDur = ((p.on.durationMs - p.off.durationMs) / 1000).toFixed(1);
    console.log(`  ${key.padEnd(48)}  Δsuccess=${dSuccess >= 0 ? "+" : ""}${dSuccess}  Δtok=${dTokens >= 0 ? "+" : ""}${dTokens}  Δdur=${dDur}s  fires(on)=${p.on.interventionsDispatched}`);
  }

  // Roll-up
  const fireRate = cells.filter((c) => c.riEnabled).reduce((acc, c) => acc + (c.interventionsDispatched > 0 ? 1 : 0), 0);
  const riCells = cells.filter((c) => c.riEnabled).length;
  console.log(`\nRI fired on ${fireRate}/${riCells} RI-on cells (${Math.round((fireRate / riCells) * 100)}%)`);

  const successOn = cells.filter((c) => c.riEnabled && c.success).length;
  const successOff = cells.filter((c) => !c.riEnabled && c.success).length;
  console.log(`Success RI-on: ${successOn}/${riCells} | RI-off: ${successOff}/${riCells}`);

  console.log(`\nJSON: ${jsonPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
