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
    it(`${strategy}: failure names strategy, no raw stack, non-empty`, async () => {
      const events = await failingRun(strategy);
      const err = events.find((e) => e._tag === "StreamError") as { cause?: string } | undefined;
      const done = events.find((e) => e._tag === "StreamCompleted") as { output?: unknown; success?: boolean } | undefined;
      const text = err?.cause ?? String(done?.output ?? "");
      expect(text.trim().length).toBeGreaterThan(0);
      expect(text).toContain(strategy);
      expect(text).not.toMatch(/\n\s+at /);
    });
  }
});
