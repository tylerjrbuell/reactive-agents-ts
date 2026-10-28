/**
 * Byte-identity gate for `observability.checklist` (plan-and-goal-primitives
 * Task 11): the live checklist is display-only, so the LLM requests an agent
 * issues must be identical with the checklist ON vs OFF. ON1 == ON2 controls
 * for process-global state. Hard gate for defaulting the option to true.
 *
 * Run: bun test packages/runtime/tests/checklist-model-invisible.test.ts --timeout 20000
 */
import { describe, test, expect } from "bun:test";
import { Layer } from "effect";
import { LLMService, TestLLMService } from "@reactive-agents/llm-provider";
import { ReactiveAgents } from "../src/builder.js";
import type { AgentStreamEvent } from "../src/stream-types.js";

type Req = import("@reactive-agents/llm-provider").CompletionRequest;

const SCENARIO = [
  { toolCall: { name: "todo", args: { action: "add", items: ["step one", "step two"] } } },
  { toolCall: { name: "todo", args: { action: "done", id: 1 } } },
  { toolCall: { name: "todo", args: { action: "done", id: 2 } } },
  { text: "FINAL ANSWER: done" },
];

function capturingLayer(captured: Req[]): Layer.Layer<LLMService> {
  const base = TestLLMService(SCENARIO);
  return Layer.succeed(
    LLMService,
    LLMService.of({
      ...base,
      complete: (r) => {
        captured.push(r);
        return base.complete(r);
      },
      stream: (r) => {
        captured.push(r);
        return base.stream(r);
      },
    }),
  );
}

/** Everything the model can see; traceContext (per-run taskId) is dropped. */
const project = (r: Req) => ({
  messages: r.messages,
  systemPrompt: r.systemPrompt,
  tools: r.tools,
  purpose: r.purpose,
  model: r.model,
  maxTokens: r.maxTokens,
  temperature: r.temperature,
  stopSequences: r.stopSequences,
});

async function runArm(checklist: boolean) {
  const captured: Req[] = [];
  const agent = await ReactiveAgents.create()
    .withName("checklist-invisible")
    .withProvider("test")
    .withModel("test-model")
    .withReasoning()
    .withMetaTools({ todo: true, recall: true })
    .withReplayLLM(capturingLayer(captured))
    .withObservability({ checklist })
    .withRequiredTools({ adaptive: false })
    .withMaxIterations(6)
    .build();
  try {
    const events: AgentStreamEvent[] = [];
    for await (const e of agent.runStream("plan and do two things", { density: "full" })) events.push(e);
    return { requests: captured.map(project), events };
  } finally {
    await agent.dispose();
  }
}

describe("observability.checklist is model-invisible", () => {
  test("LLM requests identical ON vs OFF; ON1 == ON2", async () => {
    const on1 = await runArm(true);
    const off = await runArm(false);
    const on2 = await runArm(true);

    // vacuity: requests were captured, checklist emitted when ON, silent when OFF
    expect(on1.requests.length).toBeGreaterThanOrEqual(3);
    expect(on1.events.filter((e) => e._tag === "ChecklistUpdated").length).toBeGreaterThanOrEqual(1);
    expect(off.events.filter((e) => e._tag === "ChecklistUpdated")).toHaveLength(0);
    // vacuity: the todo tool result reached the model
    const seen = JSON.stringify(on1.requests.map((r) => r.messages));
    expect(seen).toContain("step one");

    expect(JSON.stringify(on2.requests)).toBe(JSON.stringify(on1.requests));
    expect(JSON.stringify(off.requests)).toBe(JSON.stringify(on1.requests));
  });
});
