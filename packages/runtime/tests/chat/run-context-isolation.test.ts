import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { ReactiveAgents } from "../../src/builder.js";
import { ChatEngine } from "../../src/chat/engine.js";
import type { AgentResult } from "../../src/builder/types.js";
import type { RunHandle } from "../../src/run-controller.js";
import type { AgentStreamEvent } from "../../src/stream-types.js";
import type { TaskInput } from "../../src/agent/task-input.js";

/**
 * Chat-vs-run parity audit GAP 8a/8b/9: a chat turn's tool-path task is the raw
 * input (no stale prior-run block), one conversation's tool results never reach
 * another's prompt, and streamed and buffered tool turns build the same task.
 */

const REASONING_STEPS = [
  { type: "observation" as const, content: "[noop] SECRET_A_PAYLOAD rows: 1,2,3", metadata: {} },
];

function toolResult(): AgentResult {
  return {
    output: "done",
    success: true,
    taskId: "t1",
    agentId: "agent_test",
    metadata: {
      duration: 0,
      cost: 0,
      tokensUsed: 1,
      stepsCount: 1,
      toolCalls: [{ name: "noop", arguments: {} }],
      reasoningSteps: REASONING_STEPS,
    },
  };
}

function streamHandle(events: readonly AgentStreamEvent[]): RunHandle {
  async function* gen(): AsyncGenerator<AgentStreamEvent> {
    for (const e of events) yield e;
  }
  return Object.assign(gen(), {
    pause: () => {},
    resume: () => {},
    stop: (_o?: { reason?: string }) => {},
    terminate: (_o?: { reason?: string }) => {},
    status: () => "running" as const,
    inspect: () => undefined,
  });
}

describe("chat run-context isolation", () => {
  it("shared agent: conversation B's first tool turn carries none of conversation A's tool results", async () => {
    const agent = await ReactiveAgents.create()
      .withName("chat-isolation")
      .withTestScenario([
        { toolCalls: [{ name: "noop", args: { input: "SECRET_A_PAYLOAD" } }] },
        { text: "FINAL ANSWER: A done" },
        { toolCalls: [{ name: "noop", args: { input: "other" } }] },
        { text: "FINAL ANSWER: B done" },
      ])
      .withReasoning({ defaultStrategy: "reactive" })
      .withTools({
        tools: [
          {
            definition: {
              name: "noop",
              description: "Tool noop",
              parameters: [{ name: "input", type: "string" as const, description: "Input", required: true }],
              riskLevel: "low" as const,
              timeoutMs: 5_000,
              requiresApproval: false,
              source: "function" as const,
            },
            handler: (args: Record<string, unknown>) => Effect.succeed(`noop result: ${String(args.input)}`),
          },
        ],
      })
      .withRequiredTools({ tools: ["noop"] })
      .build();

    const tasks: TaskInput[] = [];
    const realRun = agent.run.bind(agent);
    agent.run = (input, opts) => {
      tasks.push(input);
      return realRun(input, opts);
    };

    try {
      const a = agent.session();
      const b = agent.session();
      await a.chat("conversation A: look it up", { useTools: true });
      await b.chat("conversation B: a different question", { useTools: true });
    } finally {
      await agent.dispose();
    }

    expect(tasks).toHaveLength(2);
    expect(tasks[0]).toBe("conversation A: look it up");
    expect(tasks[1]).toBe("conversation B: a different question");
    expect(JSON.stringify(tasks[1])).not.toContain("SECRET_A_PAYLOAD");
  });

  it("engine: a session's direct turn sees its own last tool results, another session's never does", async () => {
    const prompts: string[] = [];
    const deps = {
      complete: async ({ systemPrompt }: { systemPrompt: string }) => {
        prompts.push(systemPrompt);
        return { message: "ok" };
      },
      runTask: async () => toolResult(),
    };
    const a = new ChatEngine(deps, { sessionId: "sess_session_a" });
    const b = new ChatEngine(deps, { sessionId: "sess_session_b" });
    await a.turn("fetch it", { useTools: true });
    await a.turn("what did you find?", { useTools: false });
    await b.turn("hello", { useTools: false });

    expect(prompts[0]).toContain("SECRET_A_PAYLOAD");
    expect(prompts[1]).not.toContain("SECRET_A_PAYLOAD");
  });

  it("engine: buffered and streamed tool turns hand the host the same task", async () => {
    const seen: { via: string; input: TaskInput }[] = [];
    const engine = new ChatEngine(
      {
        complete: async () => ({ message: "unused" }),
        contextSummary: () => "static grounding",
        runTask: async (input) => {
          seen.push({ via: "buffered", input });
          return toolResult();
        },
        runStreamTask: (input) => {
          seen.push({ via: "stream", input });
          return streamHandle([
            { _tag: "StreamCompleted", output: "done", taskId: "t2", metadata: toolResult().metadata },
          ]);
        },
      },
      { sessionId: "sess_session_eq" },
    );
    await engine.turn("same question", { useTools: true });
    for await (const _ of engine.streamTurn("same question")) void _;

    expect(seen.map((s) => s.via)).toEqual(["buffered", "stream"]);
    expect(seen[0]!.input).toBe("same question");
    expect(seen[1]!.input).toBe(seen[0]!.input);
  });
});
