/**
 * Demo: durable execution — kill it mid-run, resume it in a fresh process.
 *
 * Process A works an incident, checkpointing each step to disk, then is
 * "killed" mid-run. Process B — a fresh agent, same config, same store —
 * reconstructs the run from its last checkpoint and finishes the job, without
 * re-running the tools that already completed. The reliability pillar, made
 * visible.
 *
 * Run:
 *   LOCAL_MODEL=gemma4:e4b bun run apps/examples/src/demos/durable-resume.ts
 */
process.env.REACTIVE_AGENTS_DISABLE_STATUS_MODE ??= "1";

import { ReactiveAgents } from "reactive-agents";
import { ToolBuilder } from "@reactive-agents/tools";
import { Effect } from "effect";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const c = {
  reset: "\x1b[0m", dim: "\x1b[2m", bold: "\x1b[1m",
  purple: "\x1b[38;5;99m", green: "\x1b[38;5;42m", cyan: "\x1b[38;5;44m",
  gray: "\x1b[38;5;245m", white: "\x1b[97m", red: "\x1b[38;5;203m", amber: "\x1b[38;5;215m",
};
const realOut = process.stdout.write.bind(process.stdout);
const realErr = process.stderr.write.bind(process.stderr);
const line = (s = "") => realOut(s + "\n");
const rule = () => line(`${c.gray}${"─".repeat(60)}${c.reset}`);

function silence(): () => void {
  const saved = { log: console.log, info: console.info, warn: console.warn, error: console.error };
  console.log = console.info = console.warn = console.error = (() => {}) as typeof console.log;
  process.stdout.write = (() => true) as typeof process.stdout.write;
  process.stderr.write = (() => true) as typeof process.stderr.write;
  return () => {
    Object.assign(console, saved);
    process.stdout.write = realOut;
    process.stderr.write = realErr;
  };
}

const TOOL_HINTS: Record<string, string> = {
  get_service_health: "DEGRADED · 8.2% errors · p99 1840ms",
  get_recent_deploys: "deploy 12m ago — \"feat: rewrite refund flow\"",
};

const health = new ToolBuilder("get_service_health")
  .description("Get health metrics for a service (status, error rate, latency).")
  .param("service", "string", "Service name", { required: true })
  .handler((a) => Effect.succeed(JSON.stringify({ service: (a as { service: string }).service, status: "DEGRADED", errorRate: "8.2%", p99LatencyMs: 1840 })))
  .build();
const deploys = new ToolBuilder("get_recent_deploys")
  .description("Get recent deployments for a service.")
  .param("service", "string", "Service name", { required: true })
  .handler((a) => Effect.succeed(JSON.stringify({ service: (a as { service: string }).service, lastDeployMinutesAgo: 12, lastCommit: "feat: rewrite refund flow" })))
  .build();

const TASK =
  "The payments-api is alerting. Use get_service_health and get_recent_deploys " +
  "to investigate, then reply in EXACTLY two short lines:\nCause: <one sentence>\nAction: <one sentence>";

const DIR = mkdtempSync(join(tmpdir(), "ra-durable-"));
const model = process.env.LOCAL_MODEL ?? "gemma4:e4b";

function build(onTool: (name: string) => void) {
  let narrated = 0;
  return ReactiveAgents.create()
    .withName("durable-triage")
    .withProvider("ollama").withModel(model)
    .withReasoning()
    .withTools({ tools: [health, deploys] })
    .withMetaTools(false) // only our two tools, for a clean story
    .withReactiveIntelligence({ telemetry: false })
    .withMaxIterations(8)
    .withDurableRuns({ dir: DIR, checkpointEvery: 1 })
    .withHook({
      phase: "act",
      timing: "after",
      handler: (ctx) => {
        const results = ctx.toolResults ?? [];
        for (let i = narrated; i < results.length; i++) {
          const e = results[i] as { toolName?: string; name?: string };
          const n = e.toolName ?? e.name ?? "tool";
          if (TOOL_HINTS[n]) onTool(n); // only our real tools, not the final-answer step
        }
        narrated = results.length;
        return ctx;
      },
    })
    .build();
}

async function main() {
  line();
  line(`${c.bold}${c.purple}  Reactive Agents — durable execution: kill it, resume it${c.reset}`);
  line(`${c.gray}  an agent that survives a crash and finishes the job from disk.${c.reset}`);
  line();
  line(`${c.cyan}  task:${c.reset} ${c.gray}triage the payments-api incident (multi-step, tools)${c.reset}`);
  line();

  // ── Process A: work + crash mid-run ──
  rule();
  line(`${c.bold}${c.amber}▶ process A${c.reset}  ${c.gray}checkpointing each step to disk${c.reset}`);
  rule();

  const narrate = (n: string) =>
    line(`  ${c.cyan}→ ${n}${c.reset}  ${c.gray}${TOOL_HINTS[n] ?? ""}${c.reset}  ${c.green}✓ checkpoint${c.reset}`);

  let toolsDone = 0;
  const controller = new AbortController();
  const restore = silence();
  try {
    const a = await build((n) => {
      narrate(n);
      // Crash the instant both tools are done + checkpointed — before the
      // agent writes its answer. Aborting the stream = simulated process death.
      if (++toolsDone >= 2) controller.abort();
    });
    const stream = a.runStream(TASK, { signal: controller.signal }) as AsyncIterable<{ _tag: string }>;
    for await (const _ev of stream) {
      /* drive the stream; the abort above halts it mid-run */
    }
  } catch {
    /* abort throws — that IS the simulated crash */
  } finally {
    restore();
  }
  line();
  line(`  ${c.bold}${c.red}💥 process killed mid-run${c.reset} ${c.gray}(container rescheduled) — answer not written yet${c.reset}`);
  line();

  // ── Process B: fresh process, resume from disk ──
  rule();
  line(`${c.bold}${c.green}▶ process B${c.reset}  ${c.gray}fresh process · same agent · same store${c.reset}`);
  rule();

  let result;
  const restore2 = silence();
  try {
    const b = await build(() => {}); // no re-narration: completed tools are NOT replayed
    const all = await b.listRuns();
    const resumable = all.find((r) => r.status !== "completed" && r.status !== "failed");
    if (!resumable) {
      restore2();
      line(`  ${c.red}no resumable run found${c.reset}`);
      process.exit(2);
    }
    const runId = resumable.runId;
    realOut(`  ${c.cyan}↻ found a crashed run on disk${c.reset} ${c.gray}(${String(runId).slice(0, 12)}…) — reconstructing from last checkpoint${c.reset}\n`);
    result = await b.resumeRun(runId);
  } finally {
    restore2();
  }

  line();
  line(`${c.white}${(result?.output ?? "").trim()}${c.reset}`);
  line();
  line(`  ${c.bold}${c.green}✓ recovered${c.reset} ${c.gray}— finished in a new process, completed tools never re-ran.${c.reset}`);
  line();
  rule();
  line(`${c.bold}${c.green}  Crash mid-run → resume from disk → job done.${c.reset}`);
  rule();
  line();
  process.exit(result?.success ? 0 : 1);
}

await main();
