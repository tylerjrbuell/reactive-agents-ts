/**
 * Example 06: Lightweight Composition API
 *
 * Demonstrates functional agent composition:
 * - `agentFn()` to create lazy-building callable agent primitives
 * - `pipe()` for sequential agent chains (output → input)
 * - `parallel()` for concurrent fan-out with labeled results
 * - `race()` for first-to-complete selection
 *
 * Usage:
 *   bun run apps/examples/src/foundations/06-composition.ts
 */

import { agentFn, pipe, parallel, race } from "reactive-agents";

export interface ExampleResult {
  passed: boolean;
  output: string;
  steps: number;
  tokens: number;
  durationMs: number;
}

export async function run(): Promise<ExampleResult> {
  const start = Date.now();

  // ─── agentFn: lazy callable agents ───────────────────────────────
  // Agents are not built until first invocation — lightweight to create
  const extractor = agentFn(
    { name: "extractor", provider: "test" },
    (b) => b.withTestScenario([{ text: "key facts: AI, quantum, biotech" }]),
  );

  const summarizer = agentFn(
    { name: "summarizer", provider: "test" },
    (b) =>
      b.withTestScenario([
        { text: "Summary: Three key technology trends identified." },
      ]),
  );

  // ─── pipe: sequential chain ──────────────────────────────────────
  // extractor runs first, its output feeds into summarizer
  console.log("=== Sequential Pipeline (pipe) ===");
  const pipeline = pipe(extractor, summarizer);
  const pipeResult = await pipeline("Raw research data...");
  console.log("Pipeline output:", pipeResult.output);
  console.log(
    "Composition:",
    (pipeResult.metadata as Record<string, unknown>)?.compositionType,
  );
  console.log();

  // ─── parallel: concurrent fan-out ────────────────────────────────
  // All agents run concurrently on the same input, results are labeled
  console.log("=== Parallel Analysis ===");
  const sentiment = agentFn(
    { name: "sentiment", provider: "test" },
    (b) => b.withTestScenario([{ text: "Positive sentiment (0.85)" }]),
  );
  const keywords = agentFn(
    { name: "keywords", provider: "test" },
    (b) => b.withTestScenario([{ text: "AI, machine learning, neural nets" }]),
  );
  const topics = agentFn(
    { name: "topics", provider: "test" },
    (b) => b.withTestScenario([{ text: "Technology, Research, Innovation" }]),
  );

  const analysis = parallel(sentiment, keywords, topics);
  const parallelResult = await analysis("Article about AI breakthroughs");
  console.log("Parallel output:");
  console.log(parallelResult.output);
  console.log("Success:", parallelResult.success);
  console.log();

  // ─── race: first to complete wins ────────────────────────────────
  console.log("=== Race ===");
  const fast = agentFn(
    { name: "fast-model", provider: "test" },
    (b) => b.withTestScenario([{ text: "Quick answer: 42" }]),
  );
  const thorough = agentFn(
    { name: "thorough-model", provider: "test" },
    (b) =>
      b.withTestScenario([{ text: "Detailed: The answer is 42 because..." }]),
  );

  const racer = race(fast, thorough);
  const raceResult = await racer("What is the meaning of life?");
  console.log("Race winner:", raceResult.output);
  console.log();

  // Clean up all agent instances
  await pipeline.dispose();
  await analysis.dispose();
  await racer.dispose();
  console.log("All agents disposed.");

  const passed =
    pipeResult.success &&
    parallelResult.success &&
    raceResult.success;

  return {
    passed,
    output: pipeResult.output,
    steps: 0,
    tokens: 0,
    durationMs: Date.now() - start,
  };
}

// Run directly
if (import.meta.main) {
  run()
    .then((r) => {
      console.log("\n---");
      console.log(r.passed ? "PASSED" : "FAILED", `(${r.durationMs}ms)`);
    })
    .catch(console.error);
}
