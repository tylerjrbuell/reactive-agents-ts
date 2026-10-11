/**
 * Hello Agent -- watch a Reactive Agent think, live.
 *
 * One question in, one answer out - but nothing is hidden: tokens
 * stream as they're generated, every reasoning iteration announces
 * itself, and the run finishes with an evidence receipt grading HOW
 * the answer was produced.
 *
 * Setup: add a key in StackBlitz Secrets (GOOGLE_API_KEY recommended -
 * free tier at ai.google.dev). The demo auto-detects which provider you
 * configured; see .env.example for all options.
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

const question =
  process.env.QUESTION ??
  "You are on-call for a payments API. List three plausible causes of a sudden 500 spike right after a deploy, ranked by how fast you would check each.";

async function main(): Promise<void> {
  if (!hasKeyFor(provider)) {
    printSetupGuide();
    return;
  }

  let builder = ReactiveAgents.create()
    .withName("hello-agent")
    .withProvider(provider);

  if (model) builder = builder.withModel(model);

  const agent = await builder
    .withObservability({ verbosity: "minimal" }) // quiet framework logs - the demo's own stream prints carry the story
    .withReasoning()
    .withMaxIterations(3)
    .build();

  const finisher = createFinisher();

  console.log(
    `\nProvider: ${provider}${model ? ` (${model})` : " (provider default)"}`
  );
  console.log(`Question: ${question}\n`);
  console.log("--- streaming (tokens + iterations appear live) ---\n");

  let output = "";
  let completed = false;
  let failure = "";
  let receiptLine = "";

  for await (const event of agent.runStream(question)) {
    switch (event._tag) {
      case "IterationProgress":
        console.log(
          `\n[iteration ${event.iteration}/${event.maxIterations}] ${event.status}`
        );
        break;
      case "TextDelta":
        process.stdout.write(event.text);
        break;
      case "StreamCompleted": {
        console.log();
        output = event.output;
        completed = true;
        const verdict = event.receipt?.verdict ?? "ungraded";
        const confidence = event.receipt
          ? ` ${(event.receipt.confidence * 100).toFixed(0)}%`
          : "";
        receiptLine = `verdict: ${verdict}${confidence}`;
        console.log("\n--- Evidence receipt ---");
        console.log(`  ${receiptLine} (grades the evidence trail, not the answer's truth)`);
        console.log(`  duration: ${event.metadata.duration}ms`);
        console.log(`  steps:    ${event.metadata.stepsCount}`);
        console.log(`  tokens:   ${event.metadata.tokensUsed}`);
        console.log(`  cost:     $${event.metadata.cost.toFixed(6)}`);
        break;
      }
      case "StreamError":
        failure = event.cause;
        break;
    }
  }

  await agent.dispose();

  finisher.add({
    label: `hello run (${provider})`,
    ok: completed && output.length > 0,
    detail: failure || undefined,
  });
  finisher.report();

  console.log(`\nDone. Edit src/agent.ts or set QUESTION in Secrets to make it yours.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
