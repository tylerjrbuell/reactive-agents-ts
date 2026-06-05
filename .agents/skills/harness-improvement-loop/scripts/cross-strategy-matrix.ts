/**
 * cross-strategy-matrix.ts — 5 tasks × N strategies × M models matrix probe.
 *
 * Answers Q2b: do strategies produce meaningfully different outcomes on the same
 * task, or is differentiation theoretical? Output JSON per (task, strategy, model)
 * cell with success / outputLen / tokens / durationMs / iter / outputPreview, plus
 * a flat CSV for spreadsheet analysis.
 *
 * Usage:
 *   bun .agents/skills/harness-improvement-loop/scripts/cross-strategy-matrix.ts
 *
 * Env:
 *   MATRIX_MODELS  CSV of models (default: "cogito:14b,qwen3:14b")
 *   MATRIX_TASKS   CSV of task ids (default: all)
 *   MATRIX_STRATS  CSV of strategies (default: "reactive,plan-execute-reflect,reflexion,tree-of-thought")
 *   TRACE_DIR      override default (.reactive-agents/traces/cross-strategy)
 *
 * Frontier slice (opt-in, requires OPENAI_API_KEY):
 *   MATRIX_FRONTIER=1   appends "gpt-4o-mini" to model list
 *
 * Per-cell wall-clock budget: 120s. Each cell traces to TRACE_DIR/<runId>.jsonl.
 */

import { ReactiveAgents } from "@reactive-agents/runtime";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

interface TaskSpec {
  readonly id: string;
  readonly complexity: "trivial" | "factual" | "tool-required" | "multi-step" | "critique-amenable";
  readonly task: string;
  readonly allowedTools: readonly string[];
  readonly maxIterations: number;
}

const TASKS: readonly TaskSpec[] = [
  {
    id: "t1-trivial",
    complexity: "trivial",
    task: "What is 17 multiplied by 23? Give just the number.",
    allowedTools: [],
    maxIterations: 4,
  },
  {
    id: "t2-factual",
    complexity: "factual",
    task: "In one sentence, what is the capital of Australia?",
    allowedTools: [],
    maxIterations: 4,
  },
  {
    id: "t3-tool",
    complexity: "tool-required",
    task: "Use web-search to find a recent (2024 or 2025) result about Rust async runtime tokio. Cite one URL from your search results in your answer.",
    allowedTools: ["web-search", "final-answer"],
    maxIterations: 6,
  },
  {
    id: "t4-multistep",
    complexity: "multi-step",
    task: "Explain the trade-offs between B-tree, hash, and full-text database indexing strategies. Cover when to use each (≥3 distinct sections).",
    allowedTools: [],
    maxIterations: 10,
  },
  {
    id: "t5-critique",
    complexity: "critique-amenable",
    task: "What are the main trade-offs between eventual consistency and strong consistency in distributed systems? After your first answer, critique it, then provide an improved final answer.",
    allowedTools: [],
    maxIterations: 10,
  },
];

const DEFAULT_STRATS = ["reactive", "plan-execute-reflect", "reflexion", "tree-of-thought"] as const;

interface Cell {
  task: string;
  complexity: string;
  strategy: string;
  model: string;
  success: boolean;
  outputLength: number;
  tokens: number;
  durationMs: number;
  iterationsUsed: number | null;
  costUsd: number;
  outputPreview: string;
  /** Full output — needed to judge QUALITY on unverifiable/open-ended tasks where binary success is blind. */
  output: string;
  error?: string;
}

function csvFromMatrix(cells: Cell[]): string {
  const header = "task,complexity,strategy,model,success,outputLength,tokens,iter,durationMs,costUsd";
  const lines = cells.map(
    (c) =>
      [
        c.task,
        c.complexity,
        c.strategy,
        c.model.replace(":", "_"),
        c.success ? 1 : 0,
        c.outputLength,
        c.tokens,
        c.iterationsUsed ?? -1,
        c.durationMs,
        c.costUsd.toFixed(6),
      ].join(","),
  );
  return [header, ...lines].join("\n");
}

async function runCell(task: TaskSpec, strategy: string, model: string, traceDir: string): Promise<Cell> {
  const provider = model.startsWith("gpt-") ? "openai" : "ollama";
  const start = Date.now();

  try {
    const agent = await ReactiveAgents.create()
      .withProvider(provider as "ollama" | "openai")
      .withModel({ model })
      .withReasoning({
        defaultStrategy: strategy as
          | "reactive"
          | "plan-execute-reflect"
          | "reflexion"
          | "tree-of-thought"
          | "direct",
        maxIterations: task.maxIterations,
      })
      .withTools({
        allowedTools: [...task.allowedTools] as string[],
      })
      .withTracing({ dir: traceDir })
      .build();

    const result = await agent.run(task.task);
    const durationMs = Date.now() - start;
    await agent.dispose();

    return {
      task: task.id,
      complexity: task.complexity,
      strategy,
      model,
      success: result.success,
      outputLength: result.output.length,
      // ResultMetadata schema field is `tokensUsed` (packages/core/src/types/result.ts:38),
      // not `totalTokens` (which is used in events + strategy types only).
      tokens: result.metadata?.tokensUsed ?? 0,
      durationMs,
      iterationsUsed: result.metadata?.stepsCount ?? null,
      costUsd: result.metadata?.cost ?? 0,
      outputPreview: result.output.slice(0, 300),
      output: result.output,
    };
  } catch (err) {
    return {
      task: task.id,
      complexity: task.complexity,
      strategy,
      model,
      success: false,
      outputLength: 0,
      tokens: 0,
      durationMs: Date.now() - start,
      iterationsUsed: null,
      costUsd: 0,
      outputPreview: "",
      output: "",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function main(): Promise<void> {
  const modelsList = (process.env.MATRIX_MODELS ?? "cogito:14b,qwen3:14b").split(",").map((s) => s.trim()).filter(Boolean);
  if (process.env.MATRIX_FRONTIER === "1") modelsList.push("gpt-4o-mini");
  const stratList = (process.env.MATRIX_STRATS ?? DEFAULT_STRATS.join(",")).split(",").map((s) => s.trim()).filter(Boolean);
  const taskFilter = process.env.MATRIX_TASKS?.split(",").map((s) => s.trim()).filter(Boolean);
  const tasksToRun = taskFilter ? TASKS.filter((t) => taskFilter.includes(t.id)) : TASKS;

  const traceDir = resolve(process.cwd(), process.env.TRACE_DIR ?? ".reactive-agents/traces/cross-strategy");
  mkdirSync(traceDir, { recursive: true });

  const reportsDir = resolve(process.cwd(), "wiki/Research/Harness-Reports");
  mkdirSync(reportsDir, { recursive: true });

  console.log(`\nCross-Strategy Matrix Probe`);
  console.log(`  Tasks:      ${tasksToRun.map((t) => t.id).join(", ")}`);
  console.log(`  Strategies: ${stratList.join(", ")}`);
  console.log(`  Models:     ${modelsList.join(", ")}`);
  console.log(`  Cells:      ${tasksToRun.length * stratList.length * modelsList.length}`);
  console.log(`  Trace dir:  ${traceDir}\n`);

  const cells: Cell[] = [];
  const totalCells = tasksToRun.length * stratList.length * modelsList.length;
  let cellIdx = 0;

  for (const model of modelsList) {
    for (const strategy of stratList) {
      for (const task of tasksToRun) {
        cellIdx++;
        const label = `${task.id} × ${strategy} × ${model}`;
        process.stdout.write(`[${cellIdx}/${totalCells}] ${label} ... `);
        const cell = await runCell(task, strategy, model, traceDir);
        cells.push(cell);
        const tag = cell.error ? `ERR ${cell.error.slice(0, 50)}` : `${cell.success ? "ok" : "FAIL"} ${cell.outputLength}ch ${cell.tokens}tok ${(cell.durationMs / 1000).toFixed(1)}s`;
        process.stdout.write(`${tag}\n`);
      }
    }
  }

  const ts = new Date().toISOString().slice(0, 16).replace("T", "-");
  const jsonPath = resolve(reportsDir, `cross-strategy-matrix-${ts}.json`);
  const csvPath = resolve(reportsDir, `cross-strategy-matrix-${ts}.csv`);
  writeFileSync(jsonPath, JSON.stringify(cells, null, 2));
  writeFileSync(csvPath, csvFromMatrix(cells));

  // Aggregate roll-up
  const succByStrat: Record<string, { ok: number; total: number }> = {};
  const succByModel: Record<string, { ok: number; total: number }> = {};
  for (const c of cells) {
    succByStrat[c.strategy] ??= { ok: 0, total: 0 };
    succByModel[c.model] ??= { ok: 0, total: 0 };
    succByStrat[c.strategy]!.total++;
    succByModel[c.model]!.total++;
    if (c.success) {
      succByStrat[c.strategy]!.ok++;
      succByModel[c.model]!.ok++;
    }
  }

  console.log(`\n=== Roll-up ===`);
  console.log(`Success by strategy:`);
  for (const [s, r] of Object.entries(succByStrat)) {
    console.log(`  ${s.padEnd(24)} ${r.ok}/${r.total}  (${Math.round((r.ok / r.total) * 100)}%)`);
  }
  console.log(`Success by model:`);
  for (const [m, r] of Object.entries(succByModel)) {
    console.log(`  ${m.padEnd(24)} ${r.ok}/${r.total}  (${Math.round((r.ok / r.total) * 100)}%)`);
  }

  console.log(`\nJSON: ${jsonPath}`);
  console.log(`CSV:  ${csvPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
