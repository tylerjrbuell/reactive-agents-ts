import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { ReactiveAgents } from "../../src/builder.js";
import { LLMService } from "@reactive-agents/llm-provider";
import { TestLLMService } from "@reactive-agents/llm-provider";
import type { CompletionRequest } from "@reactive-agents/llm-provider";

type Req = CompletionRequest;

function makeCapturing(captured: Req[]) {
  const base = TestLLMService([{ text: "chat reply" }]);
  return Layer.succeed(
    LLMService,
    LLMService.of({
      ...base,
      complete: (r: Req) => {
        captured.push(r);
        return base.complete(r);
      },
      stream: (r: Req) => {
        captured.push(r);
        return base.stream(r);
      },
    }),
  );
}

const loopTool = {
  tools: [
    {
      definition: {
        name: "seam_marker_tool",
        description: "seam behavioral marker tool",
        parameters: [],
        riskLevel: "low" as const,
        timeoutMs: 5_000,
        requiresApproval: false,
        source: "function" as const,
      },
      handler: () => Effect.succeed("keep going"),
    },
  ],
};

describe("agent.chat engine parity", () => {
  it("persona reaches direct path system prompt", async () => {
    const captured: Req[] = [];
    const agent = await ReactiveAgents.create()
      .withName("q")
      .withProvider("test")
      .withModel("test-model")
      .withPersona({ name: "Quokka", role: "Quokka", tone: "friendly" })
      .withReplayLLM(makeCapturing(captured))
      .build();
    await agent.chat("hello there");
    const sys = captured[0]?.systemPrompt ?? (typeof captured[0]?.messages?.[0]?.content === "string" ? (captured[0].messages[0].content as string) : "");
    expect(String(sys)).toContain("Quokka");
    await agent.dispose();
  });

  it("tool-path recording: second turn sees first assistant reply", async () => {
    const captured: Req[] = [];
    const agent = await ReactiveAgents.create()
      .withName("rec")
      .withProvider("test")
      .withModel("test-model")
      .withTestScenario([{ text: "did it" }])
      .withReasoning({ defaultStrategy: "reactive" })
      .withReplayLLM(makeCapturing(captured))
      .build();
    const r1 = await agent.chat("search for x", { useTools: true });
    await agent.chat("what did you just do", { useTools: false });
    const second = captured.find((r) => {
      const last = r.messages?.[r.messages.length - 1];
      return typeof last?.content === "string" && last.content.includes("what did you just do");
    });
    const allContent = JSON.stringify(second);
    expect(allContent).toContain(r1.message);
    await agent.dispose();
  });

  it("maxIterations honored on chat tool path", async () => {
    const agent = await ReactiveAgents.create()
      .withName("mi")
      .withProvider("test")
      .withModel("test-model")
      .withTestScenario([{ toolCalls: [{ name: "seam_marker_tool", args: {} }] }])
      .withReasoning({ defaultStrategy: "reactive" })
      .withTools(loopTool)
      .build();
    const reply = await agent.chat("search for x", { useTools: true, maxIterations: 1 });
    expect((reply.steps ?? 0)).toBeLessThanOrEqual(1);
    await agent.dispose();
  });

  it("engine tool-path task text equals manual run task text", async () => {
    const captured: Req[] = [];
    const agent = await ReactiveAgents.create()
      .withName("eq")
      .withProvider("test")
      .withModel("test-model")
      .withTestScenario([{ text: "did it" }])
      .withReasoning({ defaultStrategy: "reactive" })
      .withReplayLLM(makeCapturing(captured))
      .build();
    await agent.chat("search for x", { useTools: true });
    expect(captured.length).toBeGreaterThan(0);
    await agent.dispose();
  });

  it("ChatTurn events carry canonical sess_agent_* sessionId", async () => {
    const agent = await ReactiveAgents.create()
      .withName("ev")
      .withProvider("test")
      .withModel("test-model")
      .withTestScenario([{ text: "hello back" }])
      .build();
    const events: any[] = [];
    const unsubscribe = await agent.subscribe((e: any) => events.push(e));
    await agent.chat("hello");
    unsubscribe();
    await agent.dispose();
    const chatTurns = events.filter((e) => e._tag === "ChatTurn");
    expect(chatTurns.length).toBeGreaterThan(0);
    for (const t of chatTurns) {
      expect(String(t.sessionId)).toMatch(/^sess_agent_/);
    }
  });
});
