/**
 * Demo: same agent code, local 4B model vs frontier model.
 *
 * The point of this file is the screenshot/GIF: ONE builder, run twice, where
 * the ONLY difference is the provider/model line — and both complete the same
 * tool-using task. Local runs on your laptop (no API key, $0); frontier runs on
 * Claude. Proof of the "local-to-frontier code portability" claim.
 *
 * Prerequisites:
 *   - Ollama running with a small model pulled:  ollama pull qwen3:4b
 *   - ANTHROPIC_API_KEY set (in .env or env) for the frontier run
 *
 * Run:
 *   bun run apps/examples/src/demos/local-vs-frontier.ts
 *
 * Tune via env:
 *   LOCAL_MODEL=qwen3:4b   FRONTIER_MODEL=claude-sonnet-4-6
 *   SKIP_LOCAL=1           # frontier only
 *   SKIP_FRONTIER=1        # local only
 */
// Clean output for the screen-recording: suppress the framework's internal
// phase/status logging so the GIF shows just the banner -> result -> verdict.
// Delete this line if you'd rather show the agent "thinking" step by step.
process.env.REACTIVE_AGENTS_DISABLE_STATUS_MODE ??= "1";

import { ReactiveAgents } from "reactive-agents";
import { ToolBuilder } from "@reactive-agents/tools";
import { Effect } from "effect";

// ─── tiny ANSI helpers (GIF-friendly, no deps) ───
const c = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  purple: "\x1b[38;5;99m",
  green: "\x1b[38;5;42m",
  cyan: "\x1b[38;5;44m",
  gray: "\x1b[38;5;245m",
  white: "\x1b[97m",
};
// Capture the REAL stdout/stderr writers ONCE, before any silencing. Our own
// output — banner, LIVE tool narration (from a hook during the run), result —
// goes through these, so it survives the silencing we apply around build()/run()
// that hides framework logs (incl. the API-key preflight line). Clean recording,
// zero leaks, but the agent's tool calls still narrate so the GIF tells a story.
const realOut = process.stdout.write.bind(process.stdout);
const realErr = process.stderr.write.bind(process.stderr);
const line = (s = "") => realOut(s + "\n");

function silenceFramework(): () => void {
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

// One-line hints for the live narration (deterministic tools → known results).
const TOOL_HINTS: Record<string, string> = {
  get_service_health: "DEGRADED · 8.2% errors · p99 1840ms (5.7× normal)",
  get_recent_deploys: "deploy 12m ago — \"feat: rewrite refund flow\"",
};
const rule = () => line(`${c.gray}${"─".repeat(64)}${c.reset}`);

// Two custom tools (deterministic mock data) — the agent must call BOTH and
// correlate the results to reach a non-obvious conclusion. That's the agentic
// part: not a lookup, but "investigate → correlate → recommend".
const healthTool = ToolBuilder.create("get_service_health")
  .description("Get current health metrics for a service (status, error rate, latency).")
  .param("service", "string", "Service name, e.g. 'payments-api'", { required: true })
  .handler((args) =>
    Effect.succeed(
      JSON.stringify({
        service: args.service,
        status: "DEGRADED",
        errorRate: "8.2%",
        p99LatencyMs: 1840,
        normalP99Ms: 320,
      }),
    ),
  )
  .build();

const deploysTool = ToolBuilder.create("get_recent_deploys")
  .description("Get recent deployments for a service (when, what, who).")
  .param("service", "string", "Service name, e.g. 'payments-api'", { required: true })
  .handler((args) =>
    Effect.succeed(
      JSON.stringify({
        service: args.service,
        lastDeployMinutesAgo: 12,
        lastCommit: "feat: rewrite refund flow",
        deployedBy: "ci-bot",
        previousDeployDaysAgo: 6,
      }),
    ),
  )
  .build();

// The agentic task both models must complete (same code, both providers).
const TASK =
  "The payments-api service is alerting. Use get_service_health and " +
  "get_recent_deploys to investigate, then reply in EXACTLY two short lines, " +
  "nothing else:\nCause: <one sentence>\nAction: <one sentence>";

// THE SHARED CODE. Only `provider` + `model` differ between runs.
async function runAgent(label: string, provider: string, model: string, tint: string) {
  rule();
  line(`${c.bold}${tint}▶ ${label}${c.reset}  ${c.gray}${provider} · ${model}${c.reset}`);
  rule();

  line(`${c.gray}  investigating the alert…${c.reset}`);
  line();

  let narrated = 0;
  const restore = silenceFramework();
  const t0 = Date.now();
  let result;
  try {
    const agent = await ReactiveAgents.create()
      .withName("portability-demo")
      .withProvider(provider as "ollama" | "anthropic")
      .withModel(model)
      .withReasoning()
      .withTools({ tools: [healthTool, deploysTool] })
      .withReactiveIntelligence({ telemetry: false }) // no telemetry notice in the recording
      .withMaxIterations(8)
      // Narrate each tool call live (via the captured realOut, so it shows in
      // the recording even though framework logs are silenced) — this is the
      // story: the agent calling tools and correlating, not just a final blob.
      .withHook({
        phase: "act",
        timing: "after",
        handler: (ctx) => {
          const results = ctx.toolResults ?? [];
          for (let i = narrated; i < results.length; i++) {
            const e = results[i] as { toolName?: string; name?: string };
            const n = e.toolName ?? e.name ?? "tool";
            line(`  ${c.cyan}→ ${n}${c.reset}  ${c.gray}${TOOL_HINTS[n] ?? ""}${c.reset}`);
          }
          narrated = results.length;
          return ctx;
        },
      })
      .build();
    result = await agent.run(TASK);
  } finally {
    restore();
  }
  const ms = Date.now() - t0;

  line();
  line(`${c.bold}${tint}  recommendation${c.reset}`);
  line(`${c.white}${result.output.trim()}${c.reset}`);
  line(
    `${c.gray}  ${result.metadata.stepsCount} steps · ` +
      `${(ms / 1000).toFixed(1)}s · ` +
      `${result.metadata.tokensUsed.toLocaleString()} tokens${c.reset}`,
  );
  line(`${result.success ? `${c.green}  ✔ completed` : "  ✗ failed"}${c.reset}`);
  line();
  return result.success;
}

async function main() {
  const localModel = process.env.LOCAL_MODEL ?? "qwen3:4b";
  const frontierModel = process.env.FRONTIER_MODEL ?? "claude-sonnet-4-6";

  line();
  line(`${c.bold}${c.purple}  Reactive Agents — same code, local 4B → frontier${c.reset}`);
  line(`${c.gray}  one builder. the only line that changes is the model.${c.reset}`);
  line();
  line(`${c.dim}  await ReactiveAgents.create()`);
  line(`    .withProvider("ollama").withModel("${localModel}")        ${c.purple}// local, on your laptop${c.dim}`);
  line(`    .withProvider("anthropic").withModel("${frontierModel}")  ${c.purple}// frontier — same code${c.dim}`);
  line(`    .withReasoning().withTools({ tools: [healthTool, deploysTool] }).build()${c.reset}`);
  line();
  line(
    `${c.cyan}  task:${c.reset} ${c.gray}the payments-api is alerting — investigate with two tools and recommend a fix.${c.reset}`,
  );
  line();

  let ok = true;
  if (!process.env.SKIP_LOCAL) ok = (await runAgent("LOCAL", "ollama", localModel, c.purple)) && ok;
  if (!process.env.SKIP_FRONTIER) ok = (await runAgent("FRONTIER", "anthropic", frontierModel, c.cyan)) && ok;

  rule();
  line(`${c.bold}${ok ? c.green : c.gray}  Same code. Two models. ${ok ? "Both completed. ✔" : "(see above)"}${c.reset}`);
  rule();
  line();
  process.exit(ok ? 0 : 1);
}

await main();
