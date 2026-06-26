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

import { unlinkSync } from "node:fs";
import { ReactiveAgents } from "reactive-agents";

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
// Write our own output via stdout directly so it survives the console-silencing
// we do around build()/run() (which hides framework logs — incl. the API-key
// preflight line — so the recording stays clean and leaks nothing).
const line = (s = "") => process.stdout.write(s + "\n");

// Silence ALL framework output during build()/run() — both console.* and the
// reporters that write straight to process.stdout/stderr (tool logs, phase
// reporter, the API-key preflight line). We print our own lines outside this
// window, so the recording shows only the banner + result + verdict.
function silenceConsole(): () => void {
  const c = { log: console.log, info: console.info, warn: console.warn, error: console.error };
  const so = process.stdout.write.bind(process.stdout);
  const se = process.stderr.write.bind(process.stderr);
  const noop = () => {};
  console.log = noop;
  console.info = noop;
  console.warn = noop;
  console.error = noop;
  process.stdout.write = (() => true) as typeof process.stdout.write;
  process.stderr.write = (() => true) as typeof process.stderr.write;
  return () => {
    Object.assign(console, c);
    process.stdout.write = so;
    process.stderr.write = se;
  };
}
const rule = () => line(`${c.gray}${"─".repeat(64)}${c.reset}`);

// The single tool-using task both models must complete.
const TASK =
  "Write a one-line haiku about TypeScript to ./demo-haiku.txt using the " +
  "file-write tool, then read it back with file-read and tell me what it says.";

// THE SHARED CODE. Only `provider` + `model` differ between runs.
async function runAgent(label: string, provider: string, model: string, tint: string) {
  rule();
  line(`${c.bold}${tint}▶ ${label}${c.reset}  ${c.gray}${provider} · ${model}${c.reset}`);
  rule();

  const restore = silenceConsole();
  const t0 = Date.now();
  let result;
  try {
    const agent = await ReactiveAgents.create()
      .withName("portability-demo")
      .withProvider(provider as "ollama" | "anthropic")
      .withModel(model)
      .withReasoning()
      .withTools()
      .withReactiveIntelligence({ telemetry: false }) // no telemetry notice in the recording
      .withMaxIterations(6)
      .build();
    result = await agent.run(TASK);
  } finally {
    restore();
  }
  const ms = Date.now() - t0;

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
  line(`    .withReasoning().withTools().build()${c.reset}`);
  line();
  line(`${c.cyan}  task:${c.reset} ${c.gray}${TASK}${c.reset}`);
  line();

  let ok = true;
  if (!process.env.SKIP_LOCAL) ok = (await runAgent("LOCAL", "ollama", localModel, c.purple)) && ok;
  if (!process.env.SKIP_FRONTIER) ok = (await runAgent("FRONTIER", "anthropic", frontierModel, c.cyan)) && ok;

  rule();
  line(`${c.bold}${ok ? c.green : c.gray}  Same code. Two models. ${ok ? "Both completed. ✔" : "(see above)"}${c.reset}`);
  rule();
  line();

  // Tidy up the file the agent wrote, so re-running the demo stays clean.
  try {
    unlinkSync("./demo-haiku.txt");
  } catch {
    /* not created — fine */
  }
  process.exit(ok ? 0 : 1);
}

await main();
