// Run: bun test packages/reasoning/tests/strategies/strategy-relevant-tools-forwarding.test.ts --timeout 20000
//
// Regression: reflexion + tree-of-thought MUST forward `relevantTools` into their
// kernel passes. Under lazy tool disclosure (default) the kernel's per-iteration
// visible set = required + relevant + toolsUsed + discovered + meta-tools. If a
// strategy drops relevantTools, every classifier-relevant MCP/user tool is pruned
// and the model sees ONLY meta-tools — the spot-test GitHub-MCP failure
// (cogito looped on `find`, never saw github/list_commits). Captured the LLM
// system prompt and assert the relevant non-meta tool is visible.
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { Effect, Layer, Stream } from "effect";
import { executeReflexion } from "../../src/strategies/reflexion.js";
import { executeTreeOfThought } from "../../src/strategies/tree-of-thought.js";
import { defaultReasoningConfig } from "../../src/types/config.js";
import type { StreamEvent } from "@reactive-agents/llm-provider";

// Lazy disclosure is the default + the regime where the bug bites.
const PRIOR_LAZY = process.env.RA_LAZY_TOOLS;
beforeAll(() => {
  delete process.env.RA_LAZY_TOOLS;
});
afterAll(() => {
  if (PRIOR_LAZY === undefined) delete process.env.RA_LAZY_TOOLS;
  else process.env.RA_LAZY_TOOLS = PRIOR_LAZY;
});

function makeStreamResponse(content: string): Stream.Stream<StreamEvent, never> {
  return Stream.make(
    { type: "text_delta" as const, text: content },
    { type: "content_complete" as const, content },
    { type: "usage" as const, usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, estimatedCost: 0 } },
  ) as Stream.Stream<StreamEvent, never>;
}

async function createCapturingLayer() {
  let captured = "";
  const { LLMService: LLMSvc } = await import("@reactive-agents/llm-provider");
  const handle = (req: any) => {
    const sys = typeof req.systemPrompt === "string" ? req.systemPrompt : "";
    const toolNames = Array.isArray(req.tools) ? req.tools.map((t: any) => t.name).join(",") : "";
    captured += `${sys}\nTOOLS:${toolNames}\n`;
  };
  const layer = Layer.succeed(LLMSvc, {
    complete: (req: any) => {
      handle(req);
      return Effect.succeed({
        content: "FINAL ANSWER: done", stopReason: "end_turn" as const,
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, estimatedCost: 0 }, model: "test-model",
      });
    },
    stream: (req: any) => { handle(req); return Effect.succeed(makeStreamResponse("FINAL ANSWER: done")); },
    completeStructured: () => Effect.succeed({} as any),
    embed: (texts: string[]) => Effect.succeed(texts.map(() => [])),
    countTokens: () => Effect.succeed(0),
    getModelConfig: () => Effect.succeed({ provider: "anthropic" as const, model: "test-model" }),
  } as any);
  return { layer, getCaptured: () => captured };
}

const bigTool = {
  name: "github/list_commits",
  description: "List commits from a repo",
  parameters: [
    { name: "owner", type: "string", description: "owner", required: true },
    { name: "repo", type: "string", description: "repo", required: true },
  ],
};

describe("strategy relevantTools forwarding (lazy disclosure)", () => {
  it("reflexion surfaces a classifier-relevant non-meta tool to the model", async () => {
    const { layer, getCaptured } = await createCapturingLayer();
    await Effect.runPromise(
      executeReflexion({
        taskDescription: "List the last 10 commits and summarize them.",
        taskType: "git",
        memoryContext: "",
        availableTools: ["github/list_commits"],
        availableToolSchemas: [bigTool],
        relevantTools: ["github/list_commits"],
        config: defaultReasoningConfig,
      } as any).pipe(Effect.provide(layer)),
    );
    // Regression guard: without relevantTools forwarding, the tool is pruned
    // (not a meta-tool) and never reaches the model. Prompt shows the SANITIZED
    // name (prompt↔FC name-mismatch fix) — surfacing intent unchanged.
    expect(getCaptured()).toContain("github_list_commits");
  }, 20000);

  it("tree-of-thought surfaces a classifier-relevant non-meta tool to the model", async () => {
    const { layer, getCaptured } = await createCapturingLayer();
    await Effect.runPromise(
      executeTreeOfThought({
        taskDescription: "List the last 10 commits and summarize them.",
        taskType: "git",
        memoryContext: "",
        availableTools: ["github/list_commits"],
        availableToolSchemas: [bigTool],
        relevantTools: ["github/list_commits"],
        config: defaultReasoningConfig,
      } as any).pipe(Effect.provide(layer)),
    );
    expect(getCaptured()).toContain("github_list_commits");
  }, 20000);

  // NOTE: plan-execute shares the identical fix (relevantTools threaded through
  // plan-execute → step-executor → executeReActKernel → kernel). Its planner
  // requires a structured-output mock (getStructuredOutputCapabilities + a valid
  // plan) to drive a per-step kernel, which is out of scope here — the prune
  // mechanism it relies on is already RED-verified by the reflexion + ToT cases
  // above, and the threading is type-checked at build.
});
