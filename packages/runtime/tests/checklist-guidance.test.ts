/**
 * Opt-in todo guidance (V5) reachability + byte-identity at the runtime level:
 * `.withMetaTools({ todo: true, todoGuidance })` -> config.checklistGuidance ->
 * ReasoningService params -> KernelInput.checklistGuidance.
 *
 * Run: bun test packages/runtime/tests/checklist-guidance.test.ts --timeout 20000
 */
import { describe, test, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { LLMService, TestLLMService } from "@reactive-agents/llm-provider";
import { CHECKLIST_SYSTEM_LINE } from "../../reasoning/src/kernel/capabilities/reflect/checklist-reminder.js";
import { ReactiveAgents } from "../src/builder.js";

type Req = import("@reactive-agents/llm-provider").CompletionRequest;

// Padding keeps per-iteration token deltas above the low-delta early-exit guard.
const pad = (tag: string) => `${tag} ${"lorem ipsum dolor sit amet ".repeat(120)}`;

// todo row stays open while the model runs two non-todo tools -> reminder due.
const SCENARIO = [
  { toolCall: { name: "todo", args: { action: "add", items: ["step one", "step two"] } } },
  { toolCall: { name: "work", args: { input: pad("a") } } },
  { toolCall: { name: "work", args: { input: pad("b") } } },
  { toolCall: { name: "work", args: { input: pad("c") } } },
  { text: "FINAL ANSWER: done" },
];

const workTool = {
  definition: {
    name: "work",
    description: "Do some work",
    parameters: [{ name: "input", type: "string" as const, description: "Input", required: true }],
    riskLevel: "low" as const,
    timeoutMs: 5_000,
    requiresApproval: false,
    source: "function" as const,
  },
  handler: (args: Record<string, unknown>) => Effect.succeed(`work ok: ${String(args.input)}`),
};

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

const project = (r: Req) => ({
  messages: r.messages,
  systemPrompt: r.systemPrompt,
  tools: r.tools,
  purpose: r.purpose,
  model: r.model,
  maxTokens: r.maxTokens,
  temperature: r.temperature,
});

async function runArm(todoGuidance?: { reminder?: boolean; systemLine?: boolean }) {
  const captured: Req[] = [];
  const agent = await ReactiveAgents.create()
    .withName("checklist-guidance")
    .withProvider("test")
    .withModel("test-model")
    .withReasoning()
    .withTools({ tools: [workTool] })
    .withMetaTools({ todo: true, recall: true, ...(todoGuidance ? { todoGuidance } : {}) })
    .withReplayLLM(capturingLayer(captured))
    .withRequiredTools({ adaptive: false })
    .withMaxIterations(8)
    .build();
  try {
    await agent.run("plan and do the work");
    return captured.map(project);
  } finally {
    await agent.dispose();
  }
}

// `_tool_result_<n>` refs come from a process-global counter; normalise them.
const text = (reqs: readonly unknown[]) => JSON.stringify(reqs).replace(/_tool_result_\d+/g, "_tool_result_N");

describe("todoGuidance reaches the kernel (default off)", () => {
  test("absent / empty / all-false => byte-identical requests; on => reminder + system line", async () => {
    const base = await runArm();
    const empty = await runArm({});
    const off = await runArm({ reminder: false, systemLine: false });
    const reminder = await runArm({ reminder: true });
    const line = await runArm({ systemLine: true });

    // vacuity: the work tool ran and the baseline carries neither marker
    expect(base.length).toBeGreaterThanOrEqual(4);
    expect(text(base)).toContain("work ok: a ");
    expect(text(base)).not.toContain("Mark finished items done");
    expect(text(base)).not.toContain(CHECKLIST_SYSTEM_LINE);

    expect(text(empty)).toBe(text(base));
    expect(text(off)).toBe(text(base));

    expect(text(reminder)).toContain("Mark finished items done");
    expect(text(reminder)).not.toContain(CHECKLIST_SYSTEM_LINE);
    expect(text(line)).toContain(CHECKLIST_SYSTEM_LINE);
    expect(text(line)).not.toContain("Mark finished items done");
  });
});
