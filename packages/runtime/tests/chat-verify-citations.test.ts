import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { ReactiveAgents } from "../src/builder.js";

function makeToolDef(name: string) {
  return {
    name,
    description: `Tool ${name}`,
    parameters: [
      {
        name: "input",
        type: "string" as const,
        description: "Input",
        required: true,
      },
    ],
    riskLevel: "low" as const,
    timeoutMs: 5_000,
    requiresApproval: false,
    source: "function" as const,
  };
}

function makeToolHandler(result: string) {
  return (_args: Record<string, unknown>) => Effect.succeed(result);
}

describe("agent.chat({ verifyCitations })", () => {
  it("is inert when unset — no citationCheck field on the tool-capable path", async () => {
    const agent = await ReactiveAgents.create()
      .withName("verify-citations-unset")
      .withTestScenario([
        { toolCalls: [{ name: "search", args: { input: "x" } }] },
        { text: "FINAL ANSWER: Found it at https://example.com/page" },
      ])
      .withReasoning({ defaultStrategy: "reactive" })
      .withTools({
        tools: [
          {
            definition: makeToolDef("search"),
            handler: makeToolHandler("Evidence: https://example.com/page"),
          },
        ],
      })
      .withRequiredTools({ tools: ["search"] })
      .build();

    let reply;
    try {
      reply = await agent.chat("search for something", { useTools: true });
    } finally {
      await agent.dispose();
    }

    expect(reply.citationCheck).toBeUndefined();
  });

  it("is inert on the direct-LLM path even when set", async () => {
    const agent = await ReactiveAgents.create()
      .withName("verify-citations-direct-path")
      .withTestScenario([{ text: "Sure, no tools needed. https://example.com" }])
      .build();

    let reply;
    try {
      reply = await agent.chat("How are you today?", { verifyCitations: true });
    } finally {
      await agent.dispose();
    }

    expect(reply.citationCheck).toBeUndefined();
  });

  it("reports ok:true when cited URLs are grounded in tool evidence", async () => {
    const agent = await ReactiveAgents.create()
      .withName("verify-citations-grounded")
      .withTestScenario([
        { toolCalls: [{ name: "search", args: { input: "x" } }] },
        { text: "FINAL ANSWER: Found it at https://example.com/page" },
      ])
      .withReasoning({ defaultStrategy: "reactive" })
      .withTools({
        tools: [
          {
            definition: makeToolDef("search"),
            handler: makeToolHandler("Evidence: https://example.com/page"),
          },
        ],
      })
      .withRequiredTools({ tools: ["search"] })
      .build();

    let reply;
    try {
      reply = await agent.chat("search for something", {
        useTools: true,
        verifyCitations: true,
      });
    } finally {
      await agent.dispose();
    }

    expect(reply.citationCheck).toBeDefined();
    expect(reply.citationCheck?.ok).toBe(true);
    expect(reply.citationCheck?.uncitedUrls).toEqual([]);
  });

  it("reports ok:false with the fabricated URL when a citation isn't grounded", async () => {
    const agent = await ReactiveAgents.create()
      .withName("verify-citations-fabricated")
      .withTestScenario([
        { toolCalls: [{ name: "search", args: { input: "x" } }] },
        { text: "FINAL ANSWER: Found it at https://fabricated.example.com/nope" },
      ])
      .withReasoning({ defaultStrategy: "reactive" })
      .withTools({
        tools: [
          {
            definition: makeToolDef("search"),
            handler: makeToolHandler("Evidence: https://example.com/page"),
          },
        ],
      })
      .withRequiredTools({ tools: ["search"] })
      .build();

    let reply;
    try {
      reply = await agent.chat("search for something", {
        useTools: true,
        verifyCitations: true,
      });
    } finally {
      await agent.dispose();
    }

    expect(reply.citationCheck).toBeDefined();
    expect(reply.citationCheck?.ok).toBe(false);
    expect(reply.citationCheck?.uncitedUrls).toContain(
      "https://fabricated.example.com/nope",
    );
  });
});
