// Run: bun test packages/runtime/tests/stream-strategy-failure-surfacing.test.ts --timeout 20000
import { describe, it, expect } from "bun:test";
import { ReactiveAgents } from "../src/builder.js";
import type { AgentStreamEvent } from "../src/stream-types.js";

const STRATEGIES = [
  "reactive", "tree-of-thought", "adaptive", "direct",
  "reflexion", "plan-execute-reflect", "code-action", "blueprint",
] as const;

async function failingRun(strategy: string): Promise<AgentStreamEvent[]> {
  const agent = await ReactiveAgents.create()
    .withName("fail-surface")
    .withTestScenario([{ error: "scripted failure" }])
    .withReasoning({ defaultStrategy: strategy as never })
    .withMaxIterations(4)
    .build();
  const events: AgentStreamEvent[] = [];
  try {
    for await (const e of agent.runStream("Trigger a failure please.")) events.push(e);
  } finally {
    await agent.dispose();
  }
  return events;
}

describe("failed strategy/LLM surfaces as a named error, never a silent or raw-stack reply", () => {
  for (const strategy of STRATEGIES) {
    it(`${strategy}: failure carries its cause on error, names the strategy, no raw stack, output empty`, async () => {
      const events = await failingRun(strategy);
      const err = events.find((e) => e._tag === "StreamError") as { cause?: string } | undefined;
      const done = events.find((e) => e._tag === "StreamCompleted") as
        | { output?: unknown; success?: boolean; error?: string; metadata?: Record<string, unknown> }
        | undefined;
      // Owner decision 2026-11-10: the harness writes no text into output. A
      // failed completion keeps output "" and carries the real cause on
      // `error`; the strategy that ran is named on `metadata.strategyUsed`
      // (adaptive names its sub-strategy).
      const text = err?.cause ?? String(done?.error ?? "");
      expect(text.trim().length).toBeGreaterThan(0);
      expect(text).toContain("scripted failure");
      expect(text).not.toMatch(/\n\s+at /);
      if (done !== undefined) {
        expect(done.output).toBe("");
        const used = String(done.metadata?.strategyUsed ?? "");
        expect(used.length).toBeGreaterThan(0);
        if (strategy !== "adaptive") expect(used).toBe(strategy);
      }
    });
  }
});
