// bench/mastra-vs-ra/runner.ts
//
// Tier × Task × Framework matrix runner. Captures per-cell metrics + verifier
// verdict. Writes JSON + CSV per run to results/.
//
// Mastra usage: current API (.generate() + createTool()) — Mastra v1.36, AI SDK v5.
// RA usage: workspace HEAD (linked via node_modules/reactive-agents → packages/reactive-agents).
//
// Usage:
//   bun runner.ts                                 # all enabled tiers
//   BENCH_TIER=local bun runner.ts                # one tier
//   BENCH_TIER=local,mini bun runner.ts           # multiple
//   BENCH_TASKS=k1,t1 bun runner.ts               # subset of tasks
//   BENCH_FRAMEWORKS=ra,mastra bun runner.ts      # both default
//
// Env:
//   ANTHROPIC_API_KEY — required for frontier tier
//   OPENAI_API_KEY    — required for mini tier
//   Ollama running    — required for local tier

import { config as dotenvConfig } from "dotenv";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

// Load repo-root .env (cwd is packages/benchmarks/mastra-vs-ra; keys live at repo root).
dotenvConfig({ path: resolve(__dirname, "../../../.env") });
dotenvConfig(); // also try local .env if present (no override)

import { TASKS, type Task } from "./tasks.js";
import { verify } from "./verifier.js";
import { toolsForReactiveAgents, toolsForMastra } from "./tools.js";

// ── Framework wrappers ──────────────────────────────────────────────────────

import { ReactiveAgents, HarnessProfile } from "reactive-agents";
import { Agent } from "@mastra/core/agent";
import { stepCountIs } from "ai";

type ProviderName = "anthropic" | "openai" | "ollama";

interface ModelTier {
  readonly id: "frontier" | "mini" | "local";
  readonly provider: ProviderName;
  readonly modelId: string;
  readonly costPer1MInput: number;
  readonly costPer1MOutput: number;
}

const TIERS: readonly ModelTier[] = [
  { id: "frontier",  provider: "anthropic", modelId: "claude-sonnet-4-6",   costPer1MInput: 3.0,  costPer1MOutput: 15.0 },
  { id: "mini",      provider: "openai",    modelId: "gpt-4o-mini",         costPer1MInput: 0.15, costPer1MOutput: 0.6  },
  { id: "local",     provider: "ollama",    modelId: "qwen3.5:latest",      costPer1MInput: 0,    costPer1MOutput: 0   },
];

interface Cell {
  readonly tier: string;
  readonly framework: "ra" | "ra-lean" | "mastra";
  readonly model: string;
  readonly task: string;
  readonly category: string;
  readonly success: boolean;
  readonly reason: string;
  readonly outputLength: number;
  readonly tokens: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costUsd: number;
  readonly durationMs: number;
  readonly outputPreview: string;
  readonly error?: string;
}

const PER_CELL_TIMEOUT_MS = 180_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)),
  ]);
}

async function runReactiveAgents(
  task: Task,
  tier: ModelTier,
  opts: { lean?: boolean } = {},
): Promise<Omit<Cell, "tier" | "framework">> {
  const t0 = Date.now();
  const tools = toolsForReactiveAgents(task.tools);
  let agent: Awaited<ReturnType<typeof ReactiveAgents.create>> | null = null;
  try {
    let builder = ReactiveAgents.create()
      .withName(`ra-${opts.lean ? "lean-" : ""}${task.id}`)
      .withProvider(tier.provider)
      .withModel({ model: tier.modelId })
      .withReasoning({ defaultStrategy: "reactive", maxIterations: task.maxIterations });
    if (opts.lean) {
      // MOVE-6 — apples-to-apples Mastra-equivalent baseline: disables
      // memory + RI + verifier + strategy-switching + skill persistence.
      // True "bare LLM loop" with just the reasoning kernel.
      builder = builder.withProfile(HarnessProfile.lean());
    }
    if (tools.length > 0) {
      builder = builder.withTools({ tools });
    }
    agent = await builder.build();
    const result = await withTimeout(agent.run(task.prompt), PER_CELL_TIMEOUT_MS, `ra-${task.id}`);
    const output = (result as unknown as { output?: string }).output ?? "";
    const md = (result as unknown as { metadata?: { tokensUsed?: number; costUsd?: number; inputTokens?: number; outputTokens?: number } }).metadata ?? {};
    const tokens = md.tokensUsed ?? 0;
    const inputTokens = md.inputTokens ?? 0;
    const outputTokens = md.outputTokens ?? Math.max(0, tokens - inputTokens);
    const costUsd = md.costUsd ?? ((inputTokens / 1_000_000) * tier.costPer1MInput + (outputTokens / 1_000_000) * tier.costPer1MOutput);
    const v = verify(output, task.verifier);
    return {
      model: tier.modelId,
      task: task.id,
      category: task.category,
      success: v.passed,
      reason: v.reason,
      outputLength: output.length,
      tokens,
      inputTokens,
      outputTokens,
      costUsd,
      durationMs: Date.now() - t0,
      outputPreview: output.slice(0, 200).replace(/\n/g, " "),
    };
  } catch (err) {
    return {
      model: tier.modelId,
      task: task.id,
      category: task.category,
      success: false,
      reason: "exception",
      outputLength: 0,
      tokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      durationMs: Date.now() - t0,
      outputPreview: "",
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    if (agent) {
      try { await agent.dispose(); } catch {}
    }
  }
}

async function buildMastraModel(tier: ModelTier) {
  if (tier.provider === "anthropic") {
    const { anthropic } = await import("@ai-sdk/anthropic");
    return anthropic(tier.modelId);
  }
  if (tier.provider === "openai") {
    const { openai } = await import("@ai-sdk/openai");
    return openai(tier.modelId);
  }
  // ollama — ollama-ai-provider-v2 (AI SDK v5 compatible)
  const { createOllama } = await import("ollama-ai-provider-v2");
  return createOllama()(tier.modelId);
}

async function runMastra(task: Task, tier: ModelTier): Promise<Omit<Cell, "tier" | "framework">> {
  const t0 = Date.now();
  try {
    const model = await buildMastraModel(tier);
    const tools = toolsForMastra(task.tools);
    const agent = new Agent({
      name: `mastra-${task.id}`,
      instructions: "Answer the user's request. Use tools when provided. Keep responses focused and accurate.",
      model,
      tools: Object.keys(tools).length > 0 ? tools : undefined,
    });
    // Mastra v1.36+ current API. stopWhen.stepCount caps step count (analog to RA maxIterations).
    const result = await withTimeout(
      agent.generate(task.prompt, {
        stopWhen: stepCountIs(task.maxIterations),
      } as unknown as never),
      PER_CELL_TIMEOUT_MS,
      `mastra-${task.id}`,
    );
    const output = (result as unknown as { text?: string }).text ?? "";
    const usage = (result as unknown as { usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number; promptTokens?: number; completionTokens?: number } }).usage;
    const inputTokens = usage?.inputTokens ?? usage?.promptTokens ?? 0;
    const outputTokens = usage?.outputTokens ?? usage?.completionTokens ?? 0;
    const tokens = usage?.totalTokens ?? inputTokens + outputTokens;
    const costUsd =
      (inputTokens / 1_000_000) * tier.costPer1MInput +
      (outputTokens / 1_000_000) * tier.costPer1MOutput;
    const v = verify(output, task.verifier);
    return {
      model: tier.modelId,
      task: task.id,
      category: task.category,
      success: v.passed,
      reason: v.reason,
      outputLength: output.length,
      tokens,
      inputTokens,
      outputTokens,
      costUsd,
      durationMs: Date.now() - t0,
      outputPreview: output.slice(0, 200).replace(/\n/g, " "),
    };
  } catch (err) {
    return {
      model: tier.modelId,
      task: task.id,
      category: task.category,
      success: false,
      reason: "exception",
      outputLength: 0,
      tokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      durationMs: Date.now() - t0,
      outputPreview: "",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ── Selection helpers ───────────────────────────────────────────────────────

function selectedTiers(): readonly ModelTier[] {
  const want = (process.env.BENCH_TIER ?? "frontier,mini,local").split(",").map((s) => s.trim());
  return TIERS.filter((t) => want.includes(t.id));
}

function selectedTasks(): readonly Task[] {
  const want = (process.env.BENCH_TASKS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return want.length > 0 ? TASKS.filter((t) => want.some((w) => t.id.startsWith(w))) : TASKS;
}

function selectedFrameworks(): readonly ("ra" | "ra-lean" | "mastra")[] {
  const want = (process.env.BENCH_FRAMEWORKS ?? "ra,mastra").split(",").map((s) => s.trim()) as ("ra" | "ra-lean" | "mastra")[];
  return want;
}

// ── CSV helpers ─────────────────────────────────────────────────────────────

function csv(cells: Cell[]): string {
  const header = "tier,framework,model,task,category,success,reason,outputLen,tokens,inputTokens,outputTokens,costUsd,durationMs,error";
  const rows = cells.map((c) =>
    [
      c.tier,
      c.framework,
      c.model.replace(/[,:]/g, "_"),
      c.task,
      c.category,
      c.success ? 1 : 0,
      `"${c.reason.replace(/"/g, "''")}"`,
      c.outputLength,
      c.tokens,
      c.inputTokens,
      c.outputTokens,
      c.costUsd.toFixed(6),
      c.durationMs,
      c.error ? `"${c.error.slice(0, 80).replace(/"/g, "''")}"` : "",
    ].join(","),
  );
  return [header, ...rows].join("\n");
}

function summary(cells: Cell[]): string {
  const lines: string[] = [];
  const tiers = [...new Set(cells.map((c) => c.tier))];
  for (const tier of tiers) {
    lines.push(`\n── tier=${tier} ──`);
    const tierCells = cells.filter((c) => c.tier === tier);
    for (const fw of ["ra", "mastra"] as const) {
      const fwCells = tierCells.filter((c) => c.framework === fw);
      if (fwCells.length === 0) continue;
      const success = fwCells.filter((c) => c.success).length;
      const totalTokens = fwCells.reduce((a, c) => a + c.tokens, 0);
      const totalInput = fwCells.reduce((a, c) => a + (c.inputTokens ?? 0), 0);
      const totalOutput = fwCells.reduce((a, c) => a + (c.outputTokens ?? 0), 0);
      const totalCost = fwCells.reduce((a, c) => a + c.costUsd, 0);
      const avgDuration = fwCells.reduce((a, c) => a + c.durationMs, 0) / fwCells.length;
      lines.push(
        `  ${fw.padEnd(7)} ${String(success).padStart(2)}/${String(fwCells.length).padEnd(2)} pass · ` +
          `${totalTokens.toString().padStart(6)} tok (${totalInput.toString().padStart(5)} in / ${totalOutput.toString().padStart(5)} out) · ` +
          `$${totalCost.toFixed(4)} · ${(avgDuration / 1000).toFixed(1)}s avg`,
      );
    }
  }
  return lines.join("\n");
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const tiers = selectedTiers();
  const tasks = selectedTasks();
  const frameworks = selectedFrameworks();

  console.log(`Tiers:      ${tiers.map((t) => t.id).join(", ")}`);
  console.log(`Tasks:      ${tasks.length} (${tasks.map((t) => t.id).join(", ")})`);
  console.log(`Frameworks: ${frameworks.join(", ")}`);
  console.log(`Cells:      ${tiers.length * tasks.length * frameworks.length}`);

  const cells: Cell[] = [];
  for (const tier of tiers) {
    for (const task of tasks) {
      for (const fw of frameworks) {
        const label = `[${tier.id} · ${fw} · ${task.id}]`;
        process.stdout.write(`${label.padEnd(50)} `);
        const partial =
          fw === "ra"
            ? await runReactiveAgents(task, tier)
            : fw === "ra-lean"
              ? await runReactiveAgents(task, tier, { lean: true })
              : await runMastra(task, tier);
        const cell: Cell = { tier: tier.id, framework: fw, ...partial };
        cells.push(cell);
        const status = cell.success ? "✓" : "✗";
        const errSuffix = cell.error ? ` ERR: ${cell.error.slice(0, 60)}` : "";
        const inOut = cell.inputTokens || cell.outputTokens
          ? ` (${cell.inputTokens ?? 0}in/${cell.outputTokens ?? 0}out)`
          : "";
        console.log(`${status} ${(cell.durationMs / 1000).toFixed(1)}s ${cell.tokens}tok${inOut}${errSuffix}`);
      }
    }
  }

  mkdirSync(resolve(__dirname, "results"), { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  writeFileSync(resolve(__dirname, "results", `cells-${ts}.json`), JSON.stringify(cells, null, 2));
  writeFileSync(resolve(__dirname, "results", `cells-${ts}.csv`), csv(cells));

  console.log("\n" + "=".repeat(70));
  console.log("SUMMARY");
  console.log("=".repeat(70));
  console.log(summary(cells));
  console.log(`\nResults: packages/benchmarks/mastra-vs-ra/results/cells-${ts}.json`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
