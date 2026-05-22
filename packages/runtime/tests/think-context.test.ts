import { describe, it, expect } from "bun:test";
import {
  asThinkContext,
  getResponseModel,
  getSelectedModelName,
} from "../src/engine/phases/agent-loop/think-context.js";
import type { ExecutionContext } from "../src/types.js";

/**
 * Regression coverage for HS-08 / issue #73.
 *
 * Pins the boundary semantics of the local widening introduced to collapse
 * 9 `as any` casts in `inline-think.ts` + `reasoning-think.ts`. If a future
 * refactor reverts the widening or changes the schema, these tests fail and
 * surface the regression before it re-spreads `as any` across the codebase.
 */
describe("think-context boundary helpers (HS-08 / #73)", () => {
  function ctx(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
    return {
      taskId: "task-1",
      agentId: "agent-1",
      iteration: 0,
      phase: "think",
      messages: [],
      toolResults: [],
      cost: 0,
      tokensUsed: 0,
      memoryContext: undefined,
      selectedStrategy: undefined,
      selectedModel: undefined,
      provider: undefined,
      metadata: {},
      ...overrides,
    } as unknown as ExecutionContext;
  }

  describe("asThinkContext", () => {
    it("returns the same reference (no runtime copy)", () => {
      const c = ctx();
      expect(asThinkContext(c)).toBe(c);
    });

    it("narrows memoryContext.semanticContext access", () => {
      const c = ctx({
        memoryContext: { semanticContext: "hello world" } as unknown,
      });
      const tc = asThinkContext(c);
      expect(tc.memoryContext?.semanticContext).toBe("hello world");
    });

    it("narrows memoryContext.recentEpisodes access", () => {
      const c = ctx({
        memoryContext: {
          recentEpisodes: [
            { eventType: "task-completed", content: "done", metadata: {} },
          ],
        } as unknown,
      });
      const tc = asThinkContext(c);
      expect(tc.memoryContext?.recentEpisodes?.length).toBe(1);
      expect(tc.memoryContext?.recentEpisodes?.[0]?.eventType).toBe(
        "task-completed",
      );
    });

    it("treats undefined memoryContext safely", () => {
      const tc = asThinkContext(ctx());
      expect(tc.memoryContext?.semanticContext).toBeUndefined();
      expect(tc.memoryContext?.recentEpisodes).toBeUndefined();
    });
  });

  describe("getSelectedModelName", () => {
    it("returns undefined when selectedModel is undefined", () => {
      expect(getSelectedModelName(undefined)).toBeUndefined();
    });

    it("returns the string directly when selectedModel is a bare string", () => {
      expect(getSelectedModelName("claude-opus-4-7")).toBe("claude-opus-4-7");
    });

    it("returns the .model field when selectedModel is an object", () => {
      expect(getSelectedModelName({ model: "claude-sonnet-4-6" })).toBe(
        "claude-sonnet-4-6",
      );
    });

    it("returns undefined when object has no .model field", () => {
      expect(getSelectedModelName({} as { model?: string })).toBeUndefined();
    });
  });

  describe("getResponseModel", () => {
    it("extracts a string .model field from response", () => {
      expect(getResponseModel({ model: "gpt-4o" })).toBe("gpt-4o");
    });

    it("returns undefined when response is null/undefined", () => {
      expect(getResponseModel(null)).toBeUndefined();
      expect(getResponseModel(undefined)).toBeUndefined();
    });

    it("returns undefined when .model is not a string", () => {
      expect(getResponseModel({ model: 42 })).toBeUndefined();
      expect(getResponseModel({ model: null })).toBeUndefined();
    });

    it("returns undefined when response has no .model field", () => {
      expect(getResponseModel({ content: "hi" })).toBeUndefined();
    });

    it("ignores non-object responses", () => {
      expect(getResponseModel("a string")).toBeUndefined();
      expect(getResponseModel(42)).toBeUndefined();
    });
  });
});
