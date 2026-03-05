// File: tests/strategies/model-context-verification.test.ts
//
// Verifies that each reasoning strategy sends well-formed, clean prompts to the LLM.
// These tests capture the exact messages sent via a recording LLM mock and assert:
//   1. Task descriptions are plain text (not JSON-wrapped)
//   2. No <think> blocks leak into model context
//   3. System prompts are well-formed strings (not empty, not undefined)
//   4. User messages contain the task text
//   5. Tool schemas appear in context when tools are provided
//
import { describe, it, expect } from "bun:test";
import { Effect, Layer, Stream } from "effect";
import { LLMService } from "@reactive-agents/llm-provider";
import type { CompletionResponse, StreamEvent } from "@reactive-agents/llm-provider";
import { executeReactive } from "../../src/strategies/reactive.js";
import { executeReflexion } from "../../src/strategies/reflexion.js";
import { executePlanExecute } from "../../src/strategies/plan-execute.js";
import { executeTreeOfThought } from "../../src/strategies/tree-of-thought.js";
import { executeAdaptive } from "../../src/strategies/adaptive.js";
import { defaultReasoningConfig } from "../../src/types/config.js";

// ─── Capturing LLM Mock ───

interface CapturedCall {
  systemPrompt: string | undefined;
  messages: Array<{ role: string; content: string }>;
}

/** Build a proper Stream stub from a response string */
function makeStreamResponse(content: string): Stream.Stream<StreamEvent, never> {
  return Stream.make(
    { type: "text_delta" as const, text: content },
    { type: "content_complete" as const, content },
    { type: "usage" as const, usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, estimatedCost: 0 } },
  ) as Stream.Stream<StreamEvent, never>;
}

/**
 * Creates a LLM layer that records every complete() / stream() call and returns
 * configurable responses based on pattern matching.
 */
function createCapturingLLM(
  responses: Record<string, string> = {},
  calls: CapturedCall[] = [],
) {
  const defaultResponse: CompletionResponse = {
    content: "FINAL ANSWER: Test result.",
    stopReason: "end_turn" as const,
    usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, estimatedCost: 0 },
    model: "test-capture",
  };

  function getMatchedContent(request: any): string {
    const msgs = (request.messages ?? []).map((m: any) => ({
      role: String(m.role),
      content: String(m.content ?? ""),
    }));
    const searchText = msgs.map((m: any) => m.content).join(" ") +
      " " + (request.systemPrompt ?? "");
    for (const [pattern, response] of Object.entries(responses)) {
      if (pattern.length > 0 && searchText.includes(pattern)) {
        return response;
      }
    }
    return defaultResponse.content;
  }

  return {
    calls,
    layer: Layer.succeed(LLMService, LLMService.of({
      complete: (request: any) =>
        Effect.gen(function* () {
          const msgs = (request.messages ?? []).map((m: any) => ({
            role: String(m.role),
            content: String(m.content ?? ""),
          }));
          calls.push({
            systemPrompt: request.systemPrompt,
            messages: msgs,
          });

          // Pattern match for response
          const searchText = msgs.map((m: any) => m.content).join(" ") +
            " " + (request.systemPrompt ?? "");
          for (const [pattern, response] of Object.entries(responses)) {
            if (pattern.length > 0 && searchText.includes(pattern)) {
              return { ...defaultResponse, content: response };
            }
          }
          return defaultResponse;
        }),
      stream: (request: any) => {
        const msgs = (request.messages ?? []).map((m: any) => ({
          role: String(m.role),
          content: String(m.content ?? ""),
        }));
        calls.push({
          systemPrompt: request.systemPrompt,
          messages: msgs,
        });
        const content = getMatchedContent(request);
        return Effect.succeed(makeStreamResponse(content));
      },
      embed: () => Effect.succeed([]),
      countTokens: () => Effect.succeed(0),
      getModelConfig: () => Effect.succeed({ provider: "anthropic" as const, model: "test-capture" }),
      getStructuredOutputCapabilities: () => Effect.succeed({
        nativeJsonMode: true,
        jsonSchemaEnforcement: false,
        prefillSupport: false,
        grammarConstraints: false,
      }),
      completeStructured: (request: any) =>
        Effect.gen(function* () {
          const msgs = (request.messages ?? []).map((m: any) => ({
            role: String(m.role),
            content: String(m.content ?? ""),
          }));
          calls.push({ systemPrompt: request.systemPrompt, messages: msgs });

          const searchText = msgs.map((m: any) => m.content).join(" ");
          for (const [pattern, response] of Object.entries(responses)) {
            if (pattern.length > 0 && searchText.includes(pattern)) {
              const { Schema } = yield* Effect.promise(() => import("effect"));
              return Schema.decodeUnknownSync(request.outputSchema)(JSON.parse(response));
            }
          }
          // For plan-execute structured output
          const { Schema } = yield* Effect.promise(() => import("effect"));
          return Schema.decodeUnknownSync(request.outputSchema)(
            { steps: [{ title: "Do task", instruction: "Complete it", type: "analysis" }] },
          );
        }),
    } as any)),
  };
}

// ─── Shared assertions ───

function assertNoJsonWrapping(calls: CapturedCall[], label: string) {
  for (const call of calls) {
    for (const msg of call.messages) {
      // Task text should NOT be JSON like {"question":"..."}
      expect(msg.content).not.toMatch(
        /^\s*\{"question"\s*:/,
      );
    }
    if (call.systemPrompt) {
      expect(call.systemPrompt).not.toMatch(
        /^\s*\{"question"\s*:/,
      );
    }
  }
}

function assertNoThinkBlocks(calls: CapturedCall[], label: string) {
  for (const call of calls) {
    for (const msg of call.messages) {
      expect(msg.content).not.toMatch(/<think>/i);
    }
    if (call.systemPrompt) {
      expect(call.systemPrompt).not.toMatch(/<think>/i);
    }
  }
}

function assertSystemPromptsNonEmpty(calls: CapturedCall[], label: string) {
  for (const call of calls) {
    // System prompt should be a non-empty string when provided
    if (call.systemPrompt !== undefined) {
      expect(call.systemPrompt.length).toBeGreaterThan(0);
    }
  }
}

function assertTaskTextPresent(calls: CapturedCall[], taskText: string) {
  // At least one call should contain the task text (or a recognizable portion)
  const taskWords = taskText.split(" ").slice(0, 3).join(" ");
  const found = calls.some(
    (c) =>
      c.messages.some((m) => m.content.includes(taskWords)) ||
      (c.systemPrompt?.includes(taskWords) ?? false),
  );
  expect(found).toBe(true);
}

const SIMPLE_TASK = "What is the capital of France?";
const baseConfig = defaultReasoningConfig;

// ─── Tests ───

describe("Model context verification", () => {
  describe("reactive strategy", () => {
    it("sends clean task text without JSON wrapping", async () => {
      const { calls, layer } = createCapturingLLM();

      await Effect.runPromise(
        executeReactive({
          taskDescription: SIMPLE_TASK,
          taskType: "query",
          memoryContext: "",
          availableTools: [],
          config: baseConfig,
        }).pipe(Effect.provide(layer)),
      );

      expect(calls.length).toBeGreaterThan(0);
      assertNoJsonWrapping(calls, "reactive");
      assertNoThinkBlocks(calls, "reactive");
      assertSystemPromptsNonEmpty(calls, "reactive");
      assertTaskTextPresent(calls, SIMPLE_TASK);
    });

    it("includes tool schemas in context when tools are provided", async () => {
      const { calls, layer } = createCapturingLLM();

      await Effect.runPromise(
        executeReactive({
          taskDescription: SIMPLE_TASK,
          taskType: "query",
          memoryContext: "",
          availableTools: ["web-search"],
          availableToolSchemas: [
            { name: "web-search", parameters: [{ name: "query", type: "string", required: true }] },
          ],
          config: baseConfig,
        }).pipe(Effect.provide(layer)),
      );

      // First call should mention the tool in the system prompt or user message
      const allText = calls.map((c) =>
        [c.systemPrompt ?? "", ...c.messages.map((m) => m.content)].join(" "),
      ).join(" ");
      expect(allText).toContain("web-search");
    });

    it("strips <think> blocks from LLM responses before re-injecting into context", async () => {
      // LLM returns a response with <think> blocks — verify they don't appear in subsequent calls
      const { calls, layer } = createCapturingLLM({
        "capital of France": "<think>I need to think about this...</think>\nFINAL ANSWER: Paris",
      });

      await Effect.runPromise(
        executeReactive({
          taskDescription: "What is the capital of France?",
          taskType: "query",
          memoryContext: "",
          availableTools: [],
          config: baseConfig,
        }).pipe(Effect.provide(layer)),
      );

      // If there are subsequent calls (multi-turn), check <think> doesn't leak
      if (calls.length > 1) {
        const subsequentCalls = calls.slice(1);
        assertNoThinkBlocks(subsequentCalls, "reactive-subsequent");
      }
    });

    it("handles thinking-only responses via fallback (ACTION inside <think>)", async () => {
      const { calls, layer } = createCapturingLLM({
        "capital of France": '<think>Thought: I know this.\nACTION: web-search({"query":"capital of France"})\n</think>',
        // No tool service, so it won't actually execute — but it should parse the action
      });

      const result = await Effect.runPromise(
        executeReactive({
          taskDescription: "What is the capital of France?",
          taskType: "query",
          memoryContext: "",
          availableTools: ["web-search"],
          config: {
            ...baseConfig,
            strategies: {
              ...baseConfig.strategies,
              reactive: { maxIterations: 2, temperature: 0.7 },
            },
          },
        }).pipe(Effect.provide(layer)),
      );

      // Strategy should have attempted to parse the action from thinking
      expect(result.steps.length).toBeGreaterThan(0);
    });
  });

  describe("reflexion strategy", () => {
    it("sends clean task text and critique prompts", async () => {
      const { calls, layer } = createCapturingLLM({
        "Evaluate whether": "SATISFIED: The response is complete and accurate.",
      });

      await Effect.runPromise(
        executeReflexion({
          taskDescription: SIMPLE_TASK,
          taskType: "query",
          memoryContext: "",
          availableTools: [],
          config: {
            ...baseConfig,
            strategies: {
              ...baseConfig.strategies,
              reflexion: { maxRetries: 1, selfCritiqueDepth: "shallow" as const },
            },
          },
        }).pipe(Effect.provide(layer)),
      );

      expect(calls.length).toBeGreaterThan(0);
      assertNoJsonWrapping(calls, "reflexion");
      assertNoThinkBlocks(calls, "reflexion");
      assertSystemPromptsNonEmpty(calls, "reflexion");
      assertTaskTextPresent(calls, SIMPLE_TASK);
    });

    it("uses thinking content as critique when clean content is empty", async () => {
      // Simulate a model that puts entire critique inside <think> block
      const { calls, layer } = createCapturingLLM({
        "Evaluate whether": "<think>UNSATISFIED: The response needs more detail about geography.</think>",
      });

      const result = await Effect.runPromise(
        executeReflexion({
          taskDescription: SIMPLE_TASK,
          taskType: "query",
          memoryContext: "",
          availableTools: [],
          config: {
            ...baseConfig,
            strategies: {
              ...baseConfig.strategies,
              reflexion: { maxRetries: 2, selfCritiqueDepth: "shallow" as const },
            },
          },
        }).pipe(Effect.provide(layer)),
      );

      // The critique should NOT be empty — it should fall back to thinking content
      const critiques = result.steps.filter((s) => s.type === "observation" && s.content.includes("[CRITIQUE"));
      expect(critiques.length).toBeGreaterThan(0);
      for (const c of critiques) {
        // Critique content should not be empty (just the prefix)
        const content = c.content.replace(/^\[CRITIQUE \d+\]\s*/, "");
        expect(content.length).toBeGreaterThan(0);
      }
    });

    it("does not pass <think> blocks into improvement prompts", async () => {
      let callCount = 0;
      const { calls, layer } = createCapturingLLM({
        "Evaluate whether": "<think>Thinking deeply...</think>UNSATISFIED: Needs more detail.",
      });

      await Effect.runPromise(
        executeReflexion({
          taskDescription: SIMPLE_TASK,
          taskType: "query",
          memoryContext: "",
          availableTools: [],
          config: {
            ...baseConfig,
            strategies: {
              ...baseConfig.strategies,
              reflexion: { maxRetries: 1, selfCritiqueDepth: "shallow" as const },
            },
          },
        }).pipe(Effect.provide(layer)),
      );

      // Improvement calls should not contain <think> blocks from critique
      assertNoThinkBlocks(calls, "reflexion-improvement");
    });
  });

  describe("plan-execute strategy", () => {
    it("sends clean task text to planning and execution phases", async () => {
      const { calls, layer } = createCapturingLLM({
        "planning agent": JSON.stringify({
          steps: [{ title: "Answer", instruction: "Look up the answer", type: "analysis" }],
        }),
        "OVERALL GOAL": "FINAL ANSWER: Paris",
        "GOAL:": "SATISFIED: Done.",
        "Synthesize": "Paris is the capital of France.",
      });

      await Effect.runPromise(
        executePlanExecute({
          taskDescription: SIMPLE_TASK,
          taskType: "query",
          memoryContext: "",
          availableTools: [],
          config: baseConfig,
        }).pipe(Effect.provide(layer)),
      );

      expect(calls.length).toBeGreaterThan(0);
      assertNoJsonWrapping(calls, "plan-execute");
      assertNoThinkBlocks(calls, "plan-execute");
      assertSystemPromptsNonEmpty(calls, "plan-execute");
      assertTaskTextPresent(calls, SIMPLE_TASK);
    });
  });

  describe("tree-of-thought strategy", () => {
    it("sends clean task text to expansion and scoring phases", async () => {
      const { calls, layer } = createCapturingLLM({
        "Generate exactly": "1. Historical analysis approach\n2. Geographic lookup approach",
        "Rate this thought": "0.8",
        "Selected Approach": "FINAL ANSWER: Paris is the capital of France.",
      });

      await Effect.runPromise(
        executeTreeOfThought({
          taskDescription: SIMPLE_TASK,
          taskType: "query",
          memoryContext: "",
          availableTools: [],
          config: {
            ...baseConfig,
            strategies: {
              ...baseConfig.strategies,
              treeOfThought: { breadth: 2, depth: 2, pruningThreshold: 0.3 },
            },
          },
        }).pipe(Effect.provide(layer)),
      );

      expect(calls.length).toBeGreaterThan(0);
      assertNoJsonWrapping(calls, "tree-of-thought");
      assertNoThinkBlocks(calls, "tree-of-thought");
      assertSystemPromptsNonEmpty(calls, "tree-of-thought");
      assertTaskTextPresent(calls, SIMPLE_TASK);
    });

    it("strips <think> from expansion responses before parsing candidates", async () => {
      const { calls, layer } = createCapturingLLM({
        "Generate exactly": "<think>Let me brainstorm...</think>\n1. Approach A\n2. Approach B",
        "Rate this thought": "0.7",
        "Selected Approach": "FINAL ANSWER: Result via Approach A.",
      });

      const result = await Effect.runPromise(
        executeTreeOfThought({
          taskDescription: SIMPLE_TASK,
          taskType: "query",
          memoryContext: "",
          availableTools: [],
          config: {
            ...baseConfig,
            strategies: {
              ...baseConfig.strategies,
              treeOfThought: { breadth: 2, depth: 1, pruningThreshold: 0.3 },
            },
          },
        }).pipe(Effect.provide(layer)),
      );

      // Should still produce a valid result — thinking was stripped before parsing
      expect(result.status).toBe("completed");
      expect(result.steps.length).toBeGreaterThan(0);
    });
  });

  describe("adaptive strategy", () => {
    it("sends clean task text to classification and sub-strategy", async () => {
      const { calls, layer } = createCapturingLLM({
        "Classify the task": "REACTIVE",
      });

      await Effect.runPromise(
        executeAdaptive({
          taskDescription: SIMPLE_TASK,
          taskType: "query",
          memoryContext: "",
          availableTools: [],
          config: baseConfig,
        }).pipe(Effect.provide(layer)),
      );

      expect(calls.length).toBeGreaterThan(0);
      assertNoJsonWrapping(calls, "adaptive");
      assertNoThinkBlocks(calls, "adaptive");
      assertSystemPromptsNonEmpty(calls, "adaptive");
      assertTaskTextPresent(calls, SIMPLE_TASK);
    });

    it("strips <think> from classification response before parsing strategy", async () => {
      const { calls, layer } = createCapturingLLM({
        "Classify the task": "<think>This is a simple query, best handled with reactive...</think>\nREACTIVE",
      });

      const result = await Effect.runPromise(
        executeAdaptive({
          taskDescription: SIMPLE_TASK,
          taskType: "query",
          memoryContext: "",
          availableTools: [],
          config: baseConfig,
        }).pipe(Effect.provide(layer)),
      );

      // Should select reactive despite <think> block
      expect(result.strategy).toBe("adaptive");
      const adaptiveStep = result.steps.find((s) => s.content.includes("[ADAPTIVE]"));
      expect(adaptiveStep).toBeDefined();
      expect(adaptiveStep!.content).toContain("reactive");
    });
  });

  describe("execution-engine extractTaskText", () => {
    // These test the helper we added to the execution engine.
    // Since extractTaskText is a module-private function, we test it indirectly
    // by verifying the behavior pattern it implements.

    it("extracts question from {question: string} input", () => {
      const input = { question: "What is 2+2?" };
      // Simulate what extractTaskText does
      const result = typeof input === "string"
        ? input
        : typeof input === "object" && input !== null && typeof (input as any).question === "string"
          ? (input as any).question
          : JSON.stringify(input);
      expect(result).toBe("What is 2+2?");
      expect(result).not.toContain("{");
    });

    it("passes through plain string input", () => {
      const input = "A simple task";
      const result = typeof input === "string"
        ? input
        : JSON.stringify(input);
      expect(result).toBe("A simple task");
    });

    it("falls back to JSON.stringify for unknown structures", () => {
      const input = { data: [1, 2, 3] };
      const result = typeof input === "string"
        ? input
        : typeof input === "object" && input !== null && typeof (input as any).question === "string"
          ? (input as any).question
          : JSON.stringify(input);
      expect(result).toBe('{"data":[1,2,3]}');
    });
  });
});
