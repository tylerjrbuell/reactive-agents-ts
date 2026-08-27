#!/usr/bin/env bun
/**
 * Capture ONE real, fully-instrumented agent run to power the docs landing
 * page: hero, "see it run", trust receipt, debrief, and lifecycle-hooks
 * sections all read from the SAME run instead of disconnected snippets.
 *
 * Model: gemma4:e4b via Ollama (~4B-class local, no API key) — matches the
 * model already cited in the existing receipt for narrative consistency.
 *
 * Output: /tmp/golden-run.json (result + hook log), plus whatever
 * ~/.reactive-agents/traces/<runId>.jsonl the framework writes automatically
 * (tracing is on by default).
 */
import { mkdtempSync, writeFileSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ReactiveAgents } from "@reactive-agents/runtime";

const workDir = mkdtempSync(join(tmpdir(), "ra-golden-"));

type HookLogEntry = {
  phase: string;
  timing: "before" | "after";
  t: number;
  iter?: number;
};
const hookLog: HookLogEntry[] = [];

const PHASES = [
  "bootstrap",
  "guardrail",
  "cost-route",
  "strategy-select",
  "think",
  "act",
  "observe",
  "verify",
  "memory-flush",
  "cost-track",
  "audit",
  "complete",
] as const;

async function main() {
  let builder = ReactiveAgents.create()
    .withProvider("ollama")
    .withModel("gemma4:e4b")
    .withReasoning()
    .withTools({ builtins: true })
    .withObservability()
    // gemma4:e4b advertises a `thinking` capability. Without this the model
    // returns tool calls with no visible reasoning, so every captured thought
    // step has empty content and the run's reasoning is invisible. With it,
    // the Ollama adapter's thinking trace lands on step.metadata.thinking
    // (see think.ts thoughtMeta) — real model reasoning, capturable.
    .withThinking(true)
    // Debrief synthesis is memory-gated (see debrief.ts) — needed to capture
    // a real result.debrief alongside the receipt from the same run.
    .withMemory();

  for (const phase of PHASES) {
    for (const timing of ["before", "after"] as const) {
      builder = builder.withHook({
        phase,
        timing,
        handler: (ctx: { metadata?: { stepsCount?: number } }) => {
          hookLog.push({
            phase,
            timing,
            t: Date.now(),
            iter: ctx?.metadata?.stepsCount,
          });
        },
      });
    }
  }

  const agent = await builder.build();

  const task = `Compare the moon counts of Jupiter, Saturn, and Mars. Write a markdown report to ./report.md and the raw data as a JSON array to ./data.json.`;

  process.chdir(workDir);
  const t0 = Date.now();
  const result = await agent.run(task);
  const wallMs = Date.now() - t0;

  const out = {
    task,
    workDir,
    model: { id: "gemma4:e4b", provider: "ollama", tier: "local" },
    wallMs,
    hookLog,
    result: {
      success: result.success,
      output: result.output,
      metadata: result.metadata,
      receipt: result.receipt,
      debrief: result.debrief,
      debriefRich: await (result as { debriefRich?: () => Promise<unknown> }).debriefRich?.(),
    },
  };

  writeFileSync("/tmp/golden-run.json", JSON.stringify(out, null, 2));
  console.log("[golden-run] wrote /tmp/golden-run.json");
  console.log("[golden-run] runId:", (result.metadata as { runId?: string })?.runId);
  console.log("[golden-run] verdict:", result.receipt?.verdict);
  console.log("[golden-run] hookLog entries:", hookLog.length);

  // Surface generated files for sanity check
  try {
    const files = readdirSync(workDir);
    console.log("[golden-run] workDir files:", files);
    for (const f of files) {
      console.log(`--- ${f} ---`);
      console.log(readFileSync(join(workDir, f), "utf-8").slice(0, 400));
    }
  } catch (e) {
    console.error("[golden-run] workDir read failed:", e);
  }

  process.exit(0);
}

main().catch((e) => {
  console.error("[golden-run] FAILED:", e);
  process.exit(1);
});
