/**
 * chat() / session.chat() pick the tool loop from the agent's capability, not the
 * message wording. Zero-token: every LLM turn is scripted.
 *
 * Live bug this pins: an agent with a price tool answered "I do not have a
 * crypto-price tool" to "what is the price of bitcoin?" because the wording
 * heuristic sent the turn to the direct-LLM path.
 */
import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { ReactiveAgents } from "../src/builder.js";
import { makeChatToolIntent } from "../src/agent/chat-capabilities.js";
import { hasCapabilityTools } from "../src/builder/contract-tool-set.js";

const priceTool = {
  definition: {
    name: "crypto-price",
    description: "Current price of a cryptocurrency",
    parameters: [{ name: "input", type: "string" as const, description: "coin", required: true }],
    riskLevel: "low" as const,
    timeoutMs: 5_000,
    requiresApproval: false,
    source: "function" as const,
  },
  handler: (args: Record<string, unknown>) => Effect.succeed(`price of ${args.input}: $64,000`),
};

const priceScenario = [
  { toolCalls: [{ name: "crypto-price", args: { input: "bitcoin" } }] },
  { text: "FINAL ANSWER: Bitcoin is $64,000." },
];

const withPriceTool = (name: string, scenario: Parameters<ReturnType<typeof ReactiveAgents.create>["withTestScenario"]>[0]) =>
  ReactiveAgents.create()
    .withName(name)
    .withTestScenario(scenario)
    .withReasoning({ defaultStrategy: "reactive" })
    // allowedTools is the kernel's visibility floor: the scripted call is not dropped as "unavailable" on turn 1.
    .withTools({ tools: [priceTool], allowedTools: ["crypto-price"] });

describe("chat() routes by capability, not wording", () => {
  it("'what is the price of bitcoin?' on an agent with a price tool takes the tool loop", async () => {
    const agent = await withPriceTool("cap-bitcoin", priceScenario).build();
    try {
      const reply = await agent.chat("what is the price of bitcoin?");
      expect(reply.toolsUsed).toContain("crypto-price");
    } finally {
      await agent.dispose();
    }
  });

  it("session.chat() takes the tool loop the same way", async () => {
    const agent = await withPriceTool("cap-bitcoin-session", priceScenario).build();
    try {
      const reply = await agent.session().chat("what is the price of bitcoin?");
      expect(reply.toolsUsed).toContain("crypto-price");
    } finally {
      await agent.dispose();
    }
  });

  it("an agent with no capability tools stays on the direct path", async () => {
    const agent = await ReactiveAgents.create()
      .withName("cap-no-tools")
      .withTestScenario([{ text: "Direct answer" }])
      .build();
    try {
      const reply = await agent.chat("search for the price of bitcoin");
      expect(reply.message).toContain("Direct answer");
      expect(reply.toolsUsed).toBeUndefined();
      expect(reply.steps).toBeUndefined();
      console.log(`[overhead] direct path: tokens=${reply.tokens}`);
    } finally {
      await agent.dispose();
    }
  });

  it("a greeting on a tools agent answers without calling a tool", async () => {
    const agent = await withPriceTool("cap-greeting", [{ text: "FINAL ANSWER: Hello there!" }]).build();
    try {
      const reply = await agent.chat("hi");
      expect(reply.message).toContain("Hello there!");
      expect(reply.toolsUsed ?? []).not.toContain("crypto-price");
      expect(reply.steps).toBeDefined(); // took the kernel loop, not the direct path
      console.log(`[overhead] greeting on tools agent: steps=${reply.steps} tokens=${reply.tokens}`);
    } finally {
      await agent.dispose();
    }
  });

  it("explicit { useTools: false } still wins on a tools agent", async () => {
    const agent = await withPriceTool("cap-explicit-false", [{ text: "Forced direct" }]).build();
    try {
      const reply = await agent.chat("what is the price of bitcoin?", { useTools: false });
      expect(reply.message).toContain("Forced direct");
      expect(reply.toolsUsed).toBeUndefined();
    } finally {
      await agent.dispose();
    }
  });

  it("explicit { useTools: true } still takes the tool loop", async () => {
    const agent = await withPriceTool("cap-explicit-true", priceScenario).build();
    try {
      const reply = await agent.chat("what is the price of bitcoin?", { useTools: true });
      expect(reply.toolsUsed).toContain("crypto-price");
    } finally {
      await agent.dispose();
    }
  });
});

describe(".withToolIntent() overrides the capability default", () => {
  it("a classifier returning false keeps a tools agent on the direct path", async () => {
    const agent = await withPriceTool("cap-classifier-false", [{ text: "Direct by classifier" }])
      .withToolIntent(() => false)
      .build();
    try {
      const reply = await agent.chat("what is the price of bitcoin?");
      expect(reply.message).toContain("Direct by classifier");
      expect(reply.toolsUsed).toBeUndefined();
    } finally {
      await agent.dispose();
    }
  });

  it('"message" restores the legacy wording heuristic (opt-in)', async () => {
    const direct = await withPriceTool("cap-message-direct", [{ text: "Legacy direct" }])
      .withToolIntent("message")
      .build();
    const viaTools = await withPriceTool("cap-message-tools", priceScenario)
      .withToolIntent("message")
      .build();
    try {
      // No imperative wording: the heuristic says direct.
      const r1 = await direct.chat("what is the price of bitcoin?");
      expect(r1.toolsUsed).toBeUndefined();
      // Imperative wording: the heuristic says tools.
      const r2 = await viaTools.chat("fetch the price of bitcoin");
      expect(r2.toolsUsed).toContain("crypto-price");
    } finally {
      await direct.dispose();
      await viaTools.dispose();
    }
  });

  it('"capability" is the default spelled out', async () => {
    const agent = await withPriceTool("cap-explicit-capability", priceScenario)
      .withToolIntent("message")
      .withToolIntent("capability")
      .build();
    try {
      const reply = await agent.chat("what is the price of bitcoin?");
      expect(reply.toolsUsed).toContain("crypto-price");
    } finally {
      await agent.dispose();
    }
  });
});

describe("capability seam", () => {
  const base = { requiredTools: undefined, hasMcpServers: false, hasAgentTools: false, hasDocuments: false };

  it("hasCapabilityTools: custom tool / MCP / sub-agent / documents count; bare withTools does not", () => {
    expect(hasCapabilityTools({ ...base, toolsOptions: { tools: [priceTool] } })).toBe(true);
    expect(hasCapabilityTools({ ...base, toolsOptions: undefined, hasMcpServers: true })).toBe(true);
    expect(hasCapabilityTools({ ...base, toolsOptions: undefined, hasAgentTools: true })).toBe(true);
    expect(hasCapabilityTools({ ...base, toolsOptions: undefined, hasDocuments: true })).toBe(true);
    expect(hasCapabilityTools({ ...base, toolsOptions: {} })).toBe(false);
  });

  it("makeChatToolIntent: classifier beats capability; capability otherwise", () => {
    expect(makeChatToolIntent({ hasCapabilityTools: true })?.("anything")).toBe(true);
    expect(makeChatToolIntent({ hasCapabilityTools: false })?.("anything")).toBe(false);
    expect(makeChatToolIntent(undefined)?.("anything")).toBe(false);
    expect(makeChatToolIntent({ hasCapabilityTools: true, toolIntentClassifier: () => false })?.("x")).toBe(false);
  });
});
