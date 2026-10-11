/**
 * Tool Integration -- a live-data pipeline assembled from tool calls.
 *
 * The agent chains two built-in tools with zero extra API keys:
 *   1. crypto-price  - live BTC/ETH quotes from CoinGecko's public API
 *   2. code-execute  - computes the portfolio math in a sandbox
 * plus the `recall` meta-tool to save a working note that survives
 * context compaction.
 *
 * Built-ins are opt-in: .withTools() alone registers them, but only
 * `builtins: [...]` puts the named tools in the model's schema. This
 * demo opts into exactly the two it needs, which is the recommended
 * production pattern (small surfaces keep weak models focused).
 *
 * The stream runs at "full" density so every ToolCallStarted /
 * ToolCallCompleted event is visible: you watch the harness dispatch
 * work, not just the final answer.
 *
 * Note: all async work lives inside main() (no top-level await) so the
 * entry also loads under StackBlitz WebContainer module evaluation.
 */

import { ReactiveAgents } from "reactive-agents";
import {
  createFinisher,
  hasKeyFor,
  printSetupGuide,
  resolveProvider,
} from "./env-setup.ts";

const provider = resolveProvider("gemini");
const model = process.env.MODEL?.trim() || undefined;

const task =
  process.env.TASK ??
  "Get the current crypto price for BTC and ETH (batch both coins in one crypto-price call), " +
  "then use code-execute to compute the USD value of a portfolio holding 2 BTC and 5 ETH. " +
  "Save the result as a one-line note with the recall tool under the key `portfolio`, " +
  "and give the final answer as that single sentence.";

async function main(): Promise<void> {
  if (!hasKeyFor(provider)) {
    printSetupGuide();
    return;
  }

  let builder = ReactiveAgents.create()
    .withName("tool-integration-demo")
    .withProvider(provider);

  if (model) builder = builder.withModel(model);

  const agent = await builder
    .withObservability({ verbosity: "minimal" }) // quiet framework logs - the streamed tool events below are the show
    .withTools({ builtins: ["crypto-price", "code-execute"] }) // opt in to exactly these two
    .withReasoning({ defaultStrategy: "reactive" })            // think -> call tool -> observe -> repeat
    .withMaxIterations(8)
    .build();

  console.log(
    `\nProvider: ${provider}${model ? ` (${model})` : " (provider default)"}`
  );
  console.log(`Task: ${task}\n`);
  console.log("Watch the harness dispatch each tool call live:\n");

  const finisher = createFinisher();
  let output = "";
  let failed = "";

  for await (const event of agent.runStream(task, { density: "full" })) {
    switch (event._tag) {
      case "IterationProgress":
        console.log(`\n>> iteration ${event.iteration}/${event.maxIterations}`);
        break;
      case "ToolCallStarted":
        console.log(`   -> calling ${event.toolName}...`);
        break;
      case "ToolCallCompleted":
        console.log(
          `   <- ${event.toolName} ${event.success ? "succeeded" : "FAILED"}` +
            ` in ${event.durationMs}ms`
        );
        break;
      case "StreamCompleted": {
        output = event.output;
        if (event.toolSummary && event.toolSummary.length > 0) {
          console.log("\n--- Tool summary (per tool, from the event bus) ---");
          for (const t of event.toolSummary) {
            console.log(`   ${t.name}: ${t.calls} call(s), ${Math.round(t.avgMs)}ms avg`);
          }
        }
        console.log("\n--- Stats ---");
        console.log(`Steps:    ${event.metadata.stepsCount}`);
        console.log(`Tokens:   ${event.metadata.tokensUsed}`);
        console.log(`Cost:     $${event.metadata.cost.toFixed(6)}`);
        console.log(`Duration: ${event.metadata.duration}ms`);
        break;
      }
      case "StreamError":
        failed = event.cause;
        break;
    }
  }

  if (output.trim().length > 0) {
    console.log("\n--- Final Answer ---");
    console.log(output);
  }

  finisher.add({
    label: `tool pipeline (${provider})`,
    ok: output.trim().length > 0,
    detail: failed || (output.trim().length > 0 ? undefined : "no final answer"),
  });
  finisher.report();

  await agent.dispose();

  console.log(`\nTry changing TASK in Secrets to give the agent a different challenge!`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
