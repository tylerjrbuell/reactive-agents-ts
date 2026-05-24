/**
 * Example: Agent Event Bus Subscription
 *
 * Witnesses the typed `agent.subscribe()` surface — the canonical
 * consumer-side seam for observing agent telemetry events. Distinct
 * from `.withHarness(h => h.tap(...))` which sits at kernel
 * chokepoints for behavior transforms; subscribe() sits on the
 * EventBus for behavior observation.
 *
 * Two overloads pinned:
 *   1. Tag-filtered: `agent.subscribe("TaskStarted", handler)` —
 *      handler typed against the discriminated event variant.
 *   2. Catch-all:    `agent.subscribe(handler)` — handler receives
 *      the full AgentEvent union; use `event._tag` to discriminate.
 *
 * The new compression-coordination event variants
 * (`CompressionRecommendation` + `CompressionApplied`, shipped
 * 2026-05-24) flow through this surface too. They're advisory:
 *   - `dispatcher` source fires when the reactive controller
 *     recommends compression (entropy-driven).
 *   - `verbosity-detector` source fires when per-iteration token
 *     averages exceed 2× the tier-derived baseline.
 * The example documents the subscription pattern but does NOT
 * require those events to fire under the test provider (they're
 * triggered by entropy / verbosity signals real LLMs produce).
 *
 * Pass criterion: at least one AgentEvent received via the
 * catch-all subscription AND the typed subscription compiles +
 * unsubscribes cleanly.
 */

import { ReactiveAgents } from "reactive-agents";
import type { AgentEvent } from "@reactive-agents/core";

export interface ExampleResult {
  passed: boolean;
  output: string;
  steps: number;
  tokens: number;
  durationMs: number;
}

export async function run(opts?: { provider?: string; model?: string }): Promise<ExampleResult> {
  const start = Date.now();
  type PN = "anthropic" | "openai" | "ollama" | "gemini" | "litellm" | "test";
  const provider = (opts?.provider ?? "test") as PN;

  console.log("\n=== Agent Event Bus Subscription witness ===\n");

  const observed: { tag: string; iteration?: number; source?: string }[] = [];
  const compressionEvents: { source: string; targetTokens: number; reason: string }[] = [];

  let b = ReactiveAgents.create()
    .withName("event-bus-witness")
    .withProvider(provider)
    .withReasoning()
    .withEvents();  // semantic marker — EventBus is always on
  if (opts?.model) b = b.withModel(opts.model);
  if (provider === "test") {
    b = b.withTestScenario([
      { text: "FINAL ANSWER: ok" },
    ]);
  }

  const agent = await b.build();

  // Subscription 1: catch-all — every AgentEvent fans in here.
  const unsubAll = await agent.subscribe((event: AgentEvent) => {
    observed.push({ tag: event._tag });
  });

  // Subscription 2: tag-filtered + typed. Handler receives the
  // narrowed CompressionRecommendation variant. Type-check passes
  // because the new event variant ships in the AgentEvent union.
  const unsubCompression = await agent.subscribe(
    "CompressionRecommendation",
    (event) => {
      compressionEvents.push({
        source: event.source,
        targetTokens: event.targetTokens,
        reason: event.reason,
      });
    },
  );

  // Subscription 3: separate variant in the compression chain.
  // CompressionApplied currently emits via console.debug fallback
  // (curator-side sync-helper refactor pending) — this subscription
  // documents the typed surface and will receive events once the
  // applied-side migration ships.
  const unsubApplied = await agent.subscribe(
    "CompressionApplied",
    (event) => {
      observed.push({
        tag: event._tag,
        iteration: event.iteration,
      });
    },
  );

  const result = await agent.run("Demonstrate event subscription.");
  await agent.dispose();

  // Cleanup
  unsubAll();
  unsubCompression();
  unsubApplied();

  const sawAnyEvent = observed.length >= 1;
  console.log(`  total events received: ${observed.length}`);
  console.log(`  unique tags: ${[...new Set(observed.map((e) => e.tag))].join(", ")}`);
  console.log(`  CompressionRecommendation events: ${compressionEvents.length} (not expected to fire under test provider)`);

  const passed = result.success && sawAnyEvent;
  return {
    passed,
    output: passed
      ? `agent.subscribe() surface verified: ${observed.length} events received across ${[...new Set(observed.map((e) => e.tag))].length} tag(s). CompressionRecommendation typed subscription compiles + unsubscribes cleanly (compression-driven scenarios are live-LLM signals; see HS-128/L4).`
      : `event-bus subscribe witness FAILED — events=${observed.length} run=${result.success}`,
    steps: result.metadata.stepsCount,
    tokens: result.metadata.tokensUsed,
    durationMs: Date.now() - start,
  };
}

if (import.meta.main) {
  const r = await run();
  console.log(r.passed ? "\n✅ PASS" : "\n❌ FAIL", r.output);
  process.exit(r.passed ? 0 : 1);
}
