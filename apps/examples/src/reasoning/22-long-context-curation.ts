/**
 * Example 22: Context Curation — M5 Live Witness
 *
 * Witnesses the M5 context-curation mechanism (Phase 1 KEEP verdict:
 * 60.7% compression, 38.6% token savings) by exercising
 * `applyMessageWindowWithCompact` in `packages/reasoning/src/context/message-window.ts`.
 *
 * The function compacts a conversation when estimated tokens exceed 75% of
 * the model's budget, keeping the first user message + the most recent N
 * turns at full content and replacing older turns with a compact summary
 * `[Prior: called X → …]`.
 *
 * The mechanism has *no* dedicated Compose tag, so we witness it two ways:
 *
 *   1. **Direct witness (deterministic):** import `applyMessageWindowWithCompact`
 *      and call it on a synthetic 10-turn conversation that overflows a
 *      tight token budget. Assert post-window size < pre-window size and
 *      that the compact summary marker is present.
 *
 *   2. **In-loop witness (best-effort):** run a multi-turn agent with a
 *      narrow context profile and tap `before("think")` to record
 *      `state.messages.length` per iteration. If a real switch happens it
 *      shows up here; otherwise we still record the timeline.
 *
 * Pass criterion: the direct witness shows compression. The in-loop witness
 * is reported but doesn't gate pass/fail under the test provider since
 * single-turn scenarios don't accumulate enough context to cross 75% of
 * even the local-tier budget.
 *
 * Usage:
 *   bun run apps/examples/src/reasoning/22-long-context-curation.ts
 */

import { ReactiveAgents } from "reactive-agents";
import { applyMessageWindowWithCompact } from "@reactive-agents/reasoning";
import type { Harness } from "@reactive-agents/core";

export interface ExampleResult {
  passed: boolean;
  output: string;
  steps: number;
  tokens: number;
  durationMs: number;
}

// Plain-object messages compatible with the KernelMessage shape used by
// applyMessageWindowWithCompact. Cast at the call boundary since the
// function expects the imported KernelMessage type.
type Msg =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }> }
  | { role: "tool_result"; toolCallId: string; toolName: string; content: string };

function buildSyntheticConversation(): Msg[] {
  const msgs: Msg[] = [
    { role: "user", content: "Investigate market trends, top 5 sectors, latest news, and produce a summary." },
  ];
  // 10 assistant+tool_result turns with bulky observation content.
  for (let i = 0; i < 10; i++) {
    const toolId = `call-${i}`;
    msgs.push({
      role: "assistant",
      content: `Step ${i}: I will fetch sector data for turn ${i}.`,
      toolCalls: [
        { id: toolId, name: `fetch-sector-${i}`, arguments: { index: i } },
      ],
    });
    msgs.push({
      role: "tool_result",
      toolCallId: toolId,
      toolName: `fetch-sector-${i}`,
      // Bulky observation — each tool result ~500 chars so 10 turns ≈ 5K chars.
      content:
        `Sector ${i} report — ` +
        "lorem ipsum dolor sit amet, consectetur adipiscing elit. ".repeat(15) +
        `(end of turn ${i})`,
    });
  }
  return msgs;
}

function estimateTokens(msgs: readonly Msg[]): number {
  return msgs.reduce((sum, m) => sum + Math.ceil(((m as { content: string }).content ?? "").length / 4), 0);
}

export async function run(opts?: { provider?: string; model?: string }): Promise<ExampleResult> {
  const start = Date.now();

  type PN = "anthropic" | "openai" | "ollama" | "gemini" | "litellm" | "test";
  const provider = (opts?.provider ?? (process.env.ANTHROPIC_API_KEY ? "anthropic" : "test")) as PN;

  console.log("\n=== Context Curation Live Witness (M5) ===");
  console.log(`Mode: ${provider !== "test" ? `LIVE (${provider})` : "TEST"}\n`);

  // ─── 1. Direct witness — call the curator on a synthetic conversation ───
  const synth = buildSyntheticConversation();
  const preTokens = estimateTokens(synth);
  // Tight budget chosen so the synthetic conversation overflows it. The
  // window fires when estimated tokens exceed 75% of maxTokens.
  const maxTokens = 1_000;
  // Cast: function's signature accepts readonly KernelMessage[]; structurally
  // our Msg variants match the relevant fields.
  const windowed = applyMessageWindowWithCompact(
    synth as unknown as Parameters<typeof applyMessageWindowWithCompact>[0],
    "local",
    maxTokens,
  );
  const postTokens = estimateTokens(windowed as unknown as Msg[]);
  const compressionPct = preTokens > 0 ? ((preTokens - postTokens) / preTokens) * 100 : 0;
  const hasPriorSummary = windowed.some(
    (m) => typeof m.content === "string" && m.content.startsWith("[Prior: "),
  );

  console.log("Direct witness — applyMessageWindowWithCompact:");
  console.log(`  pre-window: ${synth.length} messages, ~${preTokens} tokens`);
  console.log(`  post-window: ${windowed.length} messages, ~${postTokens} tokens`);
  console.log(`  compression: ${compressionPct.toFixed(1)}%`);
  console.log(`  [Prior: ...] summary marker present: ${hasPriorSummary}`);

  const directWitnessPassed = postTokens < preTokens && hasPriorSummary;

  // ─── 2. In-loop witness — run a real (test-provider) agent and watch  ───
  // message growth via the `think` phase hook. Under the test provider a
  // short scenario won't actually trigger compaction, but the timeline is
  // useful to surface and we still get a successful agent run.
  const messageCounts: Array<{ iter: number; phase: string; messages: number }> = [];

  const witnessHarness = (h: Harness) => {
    h.before("think", (state) => {
      // KernelStateLike — read length only; payload is informational.
      const len = (state as { messages?: readonly unknown[] }).messages?.length ?? 0;
      messageCounts.push({ iter: state.iteration, phase: "think", messages: len });
    });
  };

  let b = ReactiveAgents.create()
    .withName("m5-curation-witness")
    .withProvider(provider);
  if (opts?.model) b = b.withModel(opts.model);
  b = b
    .withReasoning({ defaultStrategy: "reactive" })
    .withMaxIterations(4)
    .withHarness(witnessHarness);

  if (provider === "test") {
    b = b.withTestScenario([
      { text: "FINAL ANSWER: Context curation runs upstream of the LLM call when budget pressure builds." },
    ]);
  }

  const agent = await b.build();
  const result = await agent.run(
    "Summarize how the kernel curates long conversation history before each think phase.",
  );
  await agent.dispose();

  console.log("\nIn-loop witness — think-phase message counts:");
  for (const e of messageCounts) {
    console.log(`  iter=${e.iter} messages=${e.messages}`);
  }
  if (messageCounts.length === 0) {
    console.log(
      "  (no think-phase emissions captured — agent may have terminated\n" +
        "   pre-think on this scenario; direct witness is the gate.)",
    );
  }

  // Pass criterion: direct witness demonstrated compression AND the agent
  // run completed successfully.
  const passed = directWitnessPassed && result.success;

  return {
    passed,
    output:
      `m5-witness: direct-compression=${compressionPct.toFixed(1)}% ` +
      `pre=${preTokens}t post=${postTokens}t prior-marker=${hasPriorSummary} ` +
      `| ${result.output.slice(0, 80)}`,
    steps: result.metadata.stepsCount,
    tokens: result.metadata.tokensUsed,
    durationMs: Date.now() - start,
  };
}

if (import.meta.main) {
  run()
    .then((r) => {
      console.log("\n---");
      console.log(r.passed ? "PASSED" : "FAILED", `(${r.durationMs}ms)`);
      console.log(JSON.stringify(r, null, 2));
      process.exit(r.passed ? 0 : 1);
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
