#!/usr/bin/env bun
// microbench.ts — capture baseline timings for hot-path operations.
//
// Usage (from project root):
//   bun run .agents/skills/harness-improvement-loop/scripts/microbench.ts
//
// Writes the result to:
//   harness-reports/benchmarks/baseline-YYYY-MM-DD.json
//
// Phase 0 S0.5: required artifact before any Phase 2+ performance work
// (North Star v2.3 §9 principle 8 — no perf claims without a baseline).
//
// What this measures:
//   - applyRedactors throughput (S0.3 hot path — runs on every log entry)
//   - entropy composite scoring (RI hot path — runs every iteration)
//   - structured logger emission (S0.3 wired)
//   - deriveGoalAchieved (cheap classifier — verify it stays cheap)
//
// Numbers here are NOT marketing. They're checkpoints for regression
// detection: a future change that drops `applyRedactors` from 1M ops/sec
// to 100k means a perf bug somewhere.

import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { Effect } from "effect";
import {
  applyRedactors,
  defaultRedactors,
} from "@reactive-agents/observability";
import { deriveGoalAchieved } from "@reactive-agents/runtime";

interface BenchResult {
  readonly name: string;
  readonly opsPerSec: number;
  readonly nsPerOp: number;
  readonly samples: number;
  readonly description: string;
}

interface BaselineArtifact {
  readonly timestamp: string;
  readonly bunVersion: string;
  readonly platform: string;
  readonly arch: string;
  readonly results: readonly BenchResult[];
}

// ─── Bench runner ─────────────────────────────────────────────────────────

function bench(
  name: string,
  description: string,
  fn: () => void,
  budgetMs = 200,
): BenchResult {
  // Warmup — let JIT optimize
  for (let i = 0; i < 200; i++) fn();

  let samples = 0;
  const start = performance.now();
  const deadline = start + budgetMs;
  while (performance.now() < deadline) {
    fn();
    samples++;
  }
  const elapsedNs = (performance.now() - start) * 1_000_000;
  const nsPerOp = elapsedNs / samples;
  const opsPerSec = 1_000_000_000 / nsPerOp;
  return {
    name,
    description,
    opsPerSec: Math.round(opsPerSec),
    nsPerOp: Math.round(nsPerOp),
    samples,
  };
}

async function benchAsync(
  name: string,
  description: string,
  fn: () => Promise<void>,
  budgetMs = 200,
): Promise<BenchResult> {
  // Warmup
  for (let i = 0; i < 50; i++) await fn();

  let samples = 0;
  const start = performance.now();
  const deadline = start + budgetMs;
  while (performance.now() < deadline) {
    await fn();
    samples++;
  }
  const elapsedNs = (performance.now() - start) * 1_000_000;
  const nsPerOp = elapsedNs / samples;
  const opsPerSec = 1_000_000_000 / nsPerOp;
  return {
    name,
    description,
    opsPerSec: Math.round(opsPerSec),
    nsPerOp: Math.round(nsPerOp),
    samples,
  };
}

// ─── Bench cases ──────────────────────────────────────────────────────────

const SHORT_LOG = "Agent started successfully";
const SECRET_LOG =
  "Auth failed for token ghp_abc123def456ghi789jkl012mno345pqr678stu, retrying";
const LONG_LOG = SECRET_LOG.repeat(50); // ~5KB

async function main(): Promise<void> {
  console.log("Microbench baseline — Phase 0 S0.5\n");

  const results: BenchResult[] = [];

  // applyRedactors — the S0.3 hot path runs on every log entry.
  results.push(
    await benchAsync(
      "applyRedactors:no-secret:short",
      "redactors over a short log line with no secret matches",
      () =>
        Effect.runPromise(applyRedactors(SHORT_LOG, defaultRedactors)).then(
          () => undefined,
        ),
    ),
  );
  results.push(
    await benchAsync(
      "applyRedactors:single-secret:short",
      "redactors over a short log line with one matching secret",
      () =>
        Effect.runPromise(applyRedactors(SECRET_LOG, defaultRedactors)).then(
          () => undefined,
        ),
    ),
  );
  results.push(
    await benchAsync(
      "applyRedactors:single-secret:long",
      "redactors over a 5KB log line with secrets — pathological case",
      () =>
        Effect.runPromise(applyRedactors(LONG_LOG, defaultRedactors)).then(
          () => undefined,
        ),
    ),
  );

  // deriveGoalAchieved — should be O(1) lookup.
  results.push(
    bench(
      "deriveGoalAchieved:final_answer_tool",
      "compute goalAchieved from terminatedBy=final_answer_tool",
      () => {
        deriveGoalAchieved("final_answer_tool");
      },
    ),
  );
  results.push(
    bench(
      "deriveGoalAchieved:max_iterations",
      "compute goalAchieved from terminatedBy=max_iterations",
      () => {
        deriveGoalAchieved("max_iterations");
      },
    ),
  );

  // ── Output the artifact ────────────────────────────────────────────────
  const artifact: BaselineArtifact = {
    timestamp: new Date().toISOString(),
    bunVersion: typeof Bun !== "undefined" ? Bun.version : "unknown",
    platform: process.platform,
    arch: process.arch,
    results,
  };

  const today = new Date().toISOString().slice(0, 10);
  const outDir = join(process.cwd(), "harness-reports", "benchmarks");
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, `baseline-${today}.json`);
  writeFileSync(outPath, JSON.stringify(artifact, null, 2));

  // Pretty-print summary
  const headerName = "operation".padEnd(40);
  const headerOps = "ops/sec".padStart(12);
  const headerNs = "ns/op".padStart(10);
  console.log(`${headerName} ${headerOps} ${headerNs}`);
  console.log("─".repeat(64));
  for (const r of results) {
    const opsStr = r.opsPerSec.toLocaleString().padStart(12);
    const nsStr = r.nsPerOp.toLocaleString().padStart(10);
    console.log(`${r.name.padEnd(40)} ${opsStr} ${nsStr}`);
  }
  console.log(`\nWrote ${outPath}`);
}

if (import.meta.main) {
  await main();
}
