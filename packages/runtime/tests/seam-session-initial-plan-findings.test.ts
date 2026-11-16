/**
 * Seam pin: `agent.session({ initialPlanFindings })` seeds the conversation's plan findings
 * (next to `initialTodo`) so a session rebuilt after a restart/eviction still shows them on
 * `session.plan` and carries them into the next Execute turn.
 *
 * Run: bun test packages/runtime/tests/seam-session-initial-plan-findings.test.ts --timeout 30000
 *
 * Red-on-cut:
 *   - drop `initialPlanFindings` in reactive-agent.ts session() or engine.ts TodoCarry ctor arg -> P1/P2/P3 lose findings.
 *   - drop `validPlanFindings` in TodoCarry ctor -> P4 keeps malformed rows.
 */
import { describe, test, expect } from "bun:test";
import { Layer } from "effect";
import { LLMService, TestLLMService } from "@reactive-agents/llm-provider";
import type { PlanFinding } from "@reactive-agents/core";
import { ReactiveAgents } from "../src/builder.js";
import { TodoCarry, todoSeedOf } from "../src/chat/todo-seed.js";

type Req = import("@reactive-agents/llm-provider").CompletionRequest;

const build = (captured: Req[]) => {
  const base = TestLLMService([{ text: "FINAL ANSWER: done" }, { text: "FINAL ANSWER: done" }] as never);
  const layer = Layer.succeed(LLMService, LLMService.of({ ...base, complete: (r) => (captured.push(r), base.complete(r)), stream: (r) => (captured.push(r), base.stream(r)) }));
  return ReactiveAgents.create().withName("seed-findings").withProvider("test").withModel("test-model")
    .withReasoning({ defaultStrategy: "reactive" }).withReplayLLM(layer).withMaxIterations(4).build();
};

const F: PlanFinding[] = [{ id: "f1", tool: "site-list", summary: "site-42 (main)", at: 5 }];
const TODO = [{ id: "1", title: "Open the main site", status: "pending" as const }];

describe("session initialPlanFindings", () => {
  test("P1: a rebuilt session shows the stored findings on session.plan", async () => {
    const agent = await build([]);
    try {
      const session = agent.session({ initialTodo: TODO, initialPlanFindings: F });
      expect(session.plan?.findings).toEqual(F);
    } finally {
      await agent.dispose();
    }
  }, 30000);

  test("P2: the next execute turn's run carries the findings; setPlan(steps) keeps them", async () => {
    const captured: Req[] = [];
    const agent = await build(captured);
    try {
      const session = agent.session({ initialTodo: TODO, initialPlanFindings: F });
      expect(session.setPlan(["Open the main site", "Report"]).findings).toEqual(F);
      await session.chat("go", { useTools: true });
      expect(JSON.stringify(captured.map((r) => [r.systemPrompt, r.messages]))).toContain("site-42");
    } finally {
      await agent.dispose();
    }
  }, 30000);

  test("P3: the engine seed reads the findings (todoSeedOf carries them)", () => {
    expect(todoSeedOf(new TodoCarry(TODO, undefined, F)).planFindings).toEqual(F);
  });

  test("P4: empty or invalid seeds are ignored; malformed rows dropped, duplicates kept once", async () => {
    const agent = await build([]);
    try {
      expect(agent.session({ initialTodo: TODO, initialPlanFindings: [] }).plan).not.toHaveProperty("findings");
      expect(new TodoCarry(undefined, undefined, "nope").findings).toEqual([]);
      const mixed = [{ id: 1 }, null, "x", ...F, ...F];
      expect(new TodoCarry(undefined, undefined, mixed).findings).toEqual(F);
    } finally {
      await agent.dispose();
    }
  }, 30000);
});
