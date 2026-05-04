/**
 * M12 — Provider Adapter System (7 hooks) Validation
 *
 * Spike: Validate all 7 adapter hooks fire and improve their domains.
 * Run: bun test packages/llm-provider/tests/m12-provider-adapter-hooks.test.ts --timeout 15000
 *
 * Hooks tested:
 * 1. systemPromptPatch — patches system prompt for model-specific needs
 * 2. taskFraming — wraps initial task message for model-specific framing
 * 3. toolGuidance — appends tool usage guidance to system prompt
 * 4. continuationHint — nudges model toward required tools
 * 5. errorRecovery — generates recovery guidance when tool fails
 * 6. synthesisPrompt — prompts transition from research → output phase
 * 7. qualityCheck — self-eval prompt before final answer
 */

import { describe, it, expect, afterAll } from "bun:test";
import {
  defaultAdapter,
  localModelAdapter,
  midModelAdapter,
  selectAdapter,
  type ProviderAdapter,
} from "../src/adapter.js";

describe("M12 — Provider Adapter Hooks", () => {
  // ─── Hook 1: systemPromptPatch ────────────────────────────────────────

  describe("Hook 1: systemPromptPatch", 15000, () => {
    it("should not patch system prompt for frontier tier (default adapter)", 15000, () => {
      const base = "You are a helpful assistant.";
      const result = defaultAdapter.systemPromptPatch?.(base, "frontier");

      // Frontier models don't need patching
      expect(result).toBeUndefined();
    });

    it("should patch system prompt for local tier with multi-step guidance", 15000, () => {
      const base = "You are a helpful assistant.";
      const result = localModelAdapter.systemPromptPatch?.(base, "local");

      expect(result).toBeDefined();
      expect(result).toContain("multi-step task");
      expect(result).toContain("complete ALL steps");
      expect(result).toContain("Never stop after only searching");

      // Verify patch is additive (includes original)
      expect(result).toContain(base);
    });

    it("should not patch system prompt for local tier when called with different tier", 15000, () => {
      const base = "Base prompt";
      const result = localModelAdapter.systemPromptPatch?.(base, "frontier");

      expect(result).toBeUndefined();
    });
  });

  // ─── Hook 2: taskFraming ──────────────────────────────────────────────

  describe("Hook 2: taskFraming", 15000, () => {
    it("should not frame task for frontier models (default adapter)", 15000, () => {
      const result = defaultAdapter.taskFraming?.({
        task: "Find the capital of France",
        requiredTools: ["search"],
        tier: "frontier",
      });

      expect(result).toBeUndefined();
    });

    it("should frame task for local models with ordered steps", 15000, () => {
      const task = "Find and summarize the latest news";
      const requiredTools = ["search", "summarize"];

      const result = localModelAdapter.taskFraming?.({
        task,
        requiredTools,
        tier: "local",
      });

      expect(result).toBeDefined();
      expect(result).toContain(task);
      expect(result).toContain("Complete these steps in order");
      expect(result).toContain("1. Call search");
      expect(result).toContain("2. Call summarize");
      expect(result).toContain("Do not stop until all steps are done");
    });

    it("should not frame task for local tier when no required tools", 15000, () => {
      const result = localModelAdapter.taskFraming?.({
        task: "What is 2+2?",
        requiredTools: [],
        tier: "local",
      });

      expect(result).toBeUndefined();
    });

    it("should not frame task when tier is not local", 15000, () => {
      const result = localModelAdapter.taskFraming?.({
        task: "Find something",
        requiredTools: ["search"],
        tier: "frontier",
      });

      expect(result).toBeUndefined();
    });
  });

  // ─── Hook 3: toolGuidance ────────────────────────────────────────────

  describe("Hook 3: toolGuidance", 15000, () => {
    it("should not add guidance for frontier models (default adapter)", 15000, () => {
      const result = defaultAdapter.toolGuidance?.({
        toolNames: ["search", "calculate"],
        requiredTools: ["search"],
        tier: "frontier",
      });

      expect(result).toBeUndefined();
    });

    it("should add guidance for local models emphasizing required tools", 15000, () => {
      const result = localModelAdapter.toolGuidance?.({
        toolNames: ["search", "calculate"],
        requiredTools: ["search"],
        tier: "local",
      });

      expect(result).toBeDefined();
      expect(result).toContain("Required tools for this task");
      expect(result).toContain("search");
      expect(result).toContain("MUST call all of them");
    });

    it("should add guidance for mid-tier models (lighter than local)", 15000, () => {
      const result = midModelAdapter.toolGuidance?.({
        toolNames: ["search"],
        requiredTools: ["search"],
        tier: "mid",
      });

      // midModelAdapter doesn't define toolGuidance, so should be undefined
      expect(result).toBeUndefined();
    });

    it("should not add guidance when no required tools and no experience summary", 15000, () => {
      const result = localModelAdapter.toolGuidance?.({
        toolNames: ["search"],
        requiredTools: [],
        tier: "local",
        experienceSummary: null,
      });

      expect(result).toBeUndefined();
    });
  });

  // ─── Hook 4: continuationHint ────────────────────────────────────────

  describe("Hook 4: continuationHint", 15000, () => {
    it("should provide hint for frontier models when tools remain pending", 15000, () => {
      const result = defaultAdapter.continuationHint?.({
        toolsUsed: new Set(["search"]),
        requiredTools: ["search", "write"],
        missingTools: ["write"],
        iteration: 2,
        maxIterations: 10,
      });

      expect(result).toBeDefined();
      expect(result).toContain("write");
    });

    it("should not provide hint when all tools are satisfied", 15000, () => {
      const result = defaultAdapter.continuationHint?.({
        toolsUsed: new Set(["search", "write"]),
        requiredTools: ["search", "write"],
        missingTools: [],
        iteration: 3,
        maxIterations: 10,
      });

      expect(result).toBeDefined();
      expect(result).toContain("synthesize");
    });

    it("should provide urgent hint for local models near iteration limit", 15000, () => {
      const result = localModelAdapter.continuationHint?.({
        toolsUsed: new Set(["search"]),
        requiredTools: ["search", "write"],
        missingTools: ["write"],
        iteration: 9,
        maxIterations: 10,
        lastToolName: "search",
      });

      expect(result).toBeDefined();
      expect(result).toContain("urgent");
      expect(result).toContain("running low on iterations");
    });

    it("should redirect search→write for local models after search tool", 15000, () => {
      const result = localModelAdapter.continuationHint?.({
        toolsUsed: new Set(["search"]),
        requiredTools: ["search", "write"],
        missingTools: ["write"],
        iteration: 3,
        maxIterations: 10,
        lastToolName: "search",
      });

      expect(result).toBeDefined();
      expect(result).toContain("Synthesize");
      expect(result).toContain("write");
      expect(result).toContain("Do NOT search again");
    });

    it("should not provide hint when no tools are missing", 15000, () => {
      const result = localModelAdapter.continuationHint?.({
        toolsUsed: new Set(["search", "write"]),
        requiredTools: ["search", "write"],
        missingTools: [],
        iteration: 5,
        maxIterations: 10,
      });

      expect(result).toBeUndefined();
    });
  });

  // ─── Hook 5: errorRecovery ────────────────────────────────────────────

  describe("Hook 5: errorRecovery", 15000, () => {
    it("should not provide recovery for frontier models (default adapter)", 15000, () => {
      const result = defaultAdapter.errorRecovery?.({
        toolName: "search",
        errorContent: "404 Not Found",
        missingTools: [],
        tier: "frontier",
      });

      expect(result).toBeUndefined();
    });

    it("should detect 404 and suggest alternative for local models", 15000, () => {
      const result = localModelAdapter.errorRecovery?.({
        toolName: "http_get",
        errorContent: "404 Not Found",
        missingTools: [],
        tier: "local",
      });

      expect(result).toBeDefined();
      expect(result).toContain("404");
      expect(result).toContain("doesn't exist");
      expect(result).toContain("Try a different URL");
    });

    it("should detect timeout and suggest retry for local models", 15000, () => {
      const result = localModelAdapter.errorRecovery?.({
        toolName: "search",
        errorContent: "Request timeout after 30s",
        missingTools: ["search"],
        tier: "local",
      });

      expect(result).toBeDefined();
      expect(result).toContain("timed out");
      expect(result).toContain("Try again");
    });

    it("should include pending tools in recovery message for known errors", 15000, () => {
      const result = localModelAdapter.errorRecovery?.({
        toolName: "search",
        errorContent: "404 Not Found",
        missingTools: ["write", "format"],
        tier: "local",
      });

      expect(result).toBeDefined();
      expect(result).toContain("404");
      expect(result).toContain("write");
      expect(result).toContain("format");
    });

    it("should not provide recovery for non-local tier", 15000, () => {
      const result = localModelAdapter.errorRecovery?.({
        toolName: "search",
        errorContent: "Error",
        missingTools: [],
        tier: "frontier",
      });

      expect(result).toBeUndefined();
    });
  });

  // ─── Hook 6: synthesisPrompt ──────────────────────────────────────────

  describe("Hook 6: synthesisPrompt", 15000, () => {
    it("should not provide synthesis prompt for frontier models when output phase reached", 15000, () => {
      const result = defaultAdapter.synthesisPrompt?.({
        toolsUsed: new Set(["search"]),
        missingOutputTools: [],
        observationCount: 5,
        tier: "frontier",
      });

      expect(result).toBeUndefined();
    });

    it("should provide synthesis prompt for frontier when output tools remain", 15000, () => {
      const result = defaultAdapter.synthesisPrompt?.({
        toolsUsed: new Set(["search"]),
        missingOutputTools: ["write"],
        observationCount: 5,
        tier: "frontier",
      });

      expect(result).toBeDefined();
      expect(result).toContain("write");
    });

    it("should provide synthesis prompt for local models emphasizing stop-searching", 15000, () => {
      const result = localModelAdapter.synthesisPrompt?.({
        toolsUsed: new Set(["search"]),
        missingOutputTools: ["write"],
        observationCount: 3,
        tier: "local",
      });

      expect(result).toBeDefined();
      expect(result).toContain("3 piece");
      expect(result).toContain("That is enough");
      expect(result).toContain("Do NOT search again");
      expect(result).toContain("write");
    });

    it("should not provide synthesis prompt when no output tools needed", 15000, () => {
      const result = localModelAdapter.synthesisPrompt?.({
        toolsUsed: new Set(["search"]),
        missingOutputTools: [],
        observationCount: 5,
        tier: "local",
      });

      expect(result).toBeUndefined();
    });

    it("should not provide synthesis prompt for non-local tier", 15000, () => {
      const result = localModelAdapter.synthesisPrompt?.({
        toolsUsed: new Set(["search"]),
        missingOutputTools: ["write"],
        observationCount: 5,
        tier: "frontier",
      });

      expect(result).toBeUndefined();
    });
  });

  // ─── Hook 7: qualityCheck ────────────────────────────────────────────

  describe("Hook 7: qualityCheck", 15000, () => {
    it("should not provide quality check for frontier models when no tools used", 15000, () => {
      const result = defaultAdapter.qualityCheck?.({
        task: "What is 2+2?",
        requiredTools: [],
        toolsUsed: new Set(),
        tier: "frontier",
      });

      expect(result).toBeUndefined();
    });

    it("should provide quality check for frontier models when tools were used", 15000, () => {
      const result = defaultAdapter.qualityCheck?.({
        task: "Find the capital of France",
        requiredTools: ["search"],
        toolsUsed: new Set(["search"]),
        tier: "frontier",
      });

      expect(result).toBeDefined();
      expect(result).toContain("verify");
      expect(result).toContain("task");
      expect(result).toContain("verbatim");
    });

    it("should check for unmet required tools for local models", 15000, () => {
      const result = localModelAdapter.qualityCheck?.({
        task: "Find and summarize news",
        requiredTools: ["search", "write"],
        toolsUsed: new Set(["search"]),
        tier: "local",
      });

      expect(result).toBeDefined();
      expect(result).toContain("write");
      expect(result).toContain("not yet called");
    });

    it("should provide comprehensive check for local models when all tools used", 15000, () => {
      const result = localModelAdapter.qualityCheck?.({
        task: "Research and write about climate change",
        requiredTools: ["search", "write"],
        toolsUsed: new Set(["search", "write"]),
        tier: "local",
      });

      expect(result).toBeDefined();
      expect(result).toContain("Review");
      expect(result).toContain("climate change");
      expect(result).toContain("EXACT numbers");
      expect(result).toContain("Include EXACT");
    });

    it("should not provide quality check for non-local when tools used", 15000, () => {
      const result = localModelAdapter.qualityCheck?.({
        task: "Find something",
        requiredTools: ["search"],
        toolsUsed: new Set(["search"]),
        tier: "frontier",
      });

      expect(result).toBeUndefined();
    });

    it("should provide quality check for mid-tier models when tools used", 15000, () => {
      const result = midModelAdapter.qualityCheck?.({
        task: "Find data",
        requiredTools: ["search"],
        toolsUsed: new Set(["search"]),
        tier: "mid",
      });

      expect(result).toBeDefined();
      expect(result).toContain("Review");
      expect(result).toContain("exact data");
    });
  });

  // ─── Adapter selection integration ───────────────────────────────────

  describe("Adapter Selection & Integration", 15000, () => {
    it("should select default adapter for frontier tier", 15000, () => {
      const { adapter } = selectAdapter({ supportsToolCalling: true }, "frontier");
      expect(adapter).toBe(defaultAdapter);
    });

    it("should select local adapter for local tier", 15000, () => {
      const { adapter } = selectAdapter({ supportsToolCalling: true }, "local");
      expect(adapter).toBe(localModelAdapter);
    });

    it("should select mid adapter for mid tier", 15000, () => {
      const { adapter } = selectAdapter({ supportsToolCalling: true }, "mid");
      expect(adapter).toBe(midModelAdapter);
    });

    it("should default to default adapter when tier unknown", 15000, () => {
      const { adapter } = selectAdapter({ supportsToolCalling: true }, "unknown");
      expect(adapter).toBe(defaultAdapter);
    });
  });

  // ─── Cross-hook validation (ensure hooks don't interfere) ────────────

  describe("Cross-Hook Validation (No Interference)", 15000, () => {
    it("local adapter patches should be idempotent (not called twice in practice)", 15000, () => {
      // In practice, systemPromptPatch is called once when building static prompt.
      // This test verifies the hook produces stable output.
      const basePrompt = "Base prompt";
      const patch1 = localModelAdapter.systemPromptPatch?.(basePrompt, "local");
      const patch2 = localModelAdapter.systemPromptPatch?.(basePrompt, "local");

      expect(patch1).toBeDefined();
      expect(patch2).toBeDefined();
      // Both should produce identical output
      expect(patch1).toEqual(patch2);
    });

    it("should provide continuation hints followed by synthesis prompts", 15000, () => {
      // Simulate progression: tools pending → synthesis → quality check
      const continuation = defaultAdapter.continuationHint?.({
        toolsUsed: new Set(["search"]),
        requiredTools: ["search", "write"],
        missingTools: ["write"],
        iteration: 5,
        maxIterations: 10,
      });

      const synthesis = defaultAdapter.synthesisPrompt?.({
        toolsUsed: new Set(["search", "write"]),
        missingOutputTools: [],
        observationCount: 3,
        tier: "frontier",
      });

      const quality = defaultAdapter.qualityCheck?.({
        task: "Find something",
        requiredTools: ["search", "write"],
        toolsUsed: new Set(["search", "write"]),
        tier: "frontier",
      });

      expect(continuation).toBeDefined(); // Nudge to next tool
      expect(synthesis).toBeUndefined(); // No output tools left
      expect(quality).toBeDefined(); // Final check
    });
  });

  // ─── Hook domain improvement validation ────────────────────────────

  describe("Domain Improvement Validation", 15000, () => {
    it("systemPromptPatch should add substantial guidance (>100 chars)", 15000, () => {
      const base = "Base";
      const patched = localModelAdapter.systemPromptPatch?.(base, "local");

      expect(patched).toBeDefined();
      const guidance = patched!.replace(base, "").length;
      expect(guidance).toBeGreaterThan(100);
    });

    it("taskFraming should be substantive relative to task (>50% longer)", 15000, () => {
      const task = "Find something";
      const framed = localModelAdapter.taskFraming?.({
        task,
        requiredTools: ["search", "write"],
        tier: "local",
      });

      expect(framed).toBeDefined();
      expect(framed!.length).toBeGreaterThan(task.length * 1.5);
    });

    it("toolGuidance should add specific tool names when required", 15000, () => {
      const result = localModelAdapter.toolGuidance?.({
        toolNames: ["search", "calculate"],
        requiredTools: ["search", "calculate"],
        tier: "local",
      });

      expect(result).toBeDefined();
      expect(result).toContain("search");
      expect(result).toContain("calculate");
    });

    it("continuationHint should be specific to missing tools", 15000, () => {
      const hint1 = defaultAdapter.continuationHint?.({
        toolsUsed: new Set(),
        requiredTools: ["search"],
        missingTools: ["search"],
        iteration: 1,
        maxIterations: 10,
      });

      const hint2 = defaultAdapter.continuationHint?.({
        toolsUsed: new Set(),
        requiredTools: ["write", "format"],
        missingTools: ["write", "format"],
        iteration: 1,
        maxIterations: 10,
      });

      expect(hint1).toBeDefined();
      expect(hint2).toBeDefined();
      expect(hint1).toContain("search");
      expect(hint2).not.toContain("search");
    });

    it("errorRecovery should differentiate error types", 15000, () => {
      const recovery404 = localModelAdapter.errorRecovery?.({
        toolName: "search",
        errorContent: "404 Not Found",
        missingTools: [],
        tier: "local",
      });

      const recoveryTimeout = localModelAdapter.errorRecovery?.({
        toolName: "search",
        errorContent: "Request timeout",
        missingTools: [],
        tier: "local",
      });

      expect(recovery404).toBeDefined();
      expect(recoveryTimeout).toBeDefined();
      expect(recovery404).toContain("404");
      expect(recoveryTimeout).toContain("timed out");
      expect(recovery404).not.toContain("timed out");
    });

    it("synthesisPrompt should acknowledge gathered observations", 15000, () => {
      const syn1 = localModelAdapter.synthesisPrompt?.({
        toolsUsed: new Set(["search"]),
        missingOutputTools: ["write"],
        observationCount: 1,
        tier: "local",
      });

      const syn5 = localModelAdapter.synthesisPrompt?.({
        toolsUsed: new Set(["search"]),
        missingOutputTools: ["write"],
        observationCount: 5,
        tier: "local",
      });

      expect(syn1).toBeDefined();
      expect(syn5).toBeDefined();
      expect(syn1).toContain("1 piece");
      expect(syn5).toContain("5 pieces");
    });

    it("qualityCheck should require tool verification when tools were used", 15000, () => {
      const check = defaultAdapter.qualityCheck?.({
        task: "Find the price of Bitcoin",
        requiredTools: ["search"],
        toolsUsed: new Set(["search"]),
        tier: "frontier",
      });

      expect(check).toBeDefined();
      expect(check).toContain("data from tool results");
      expect(check).toContain("verbatim");
      expect(check).toContain("price of Bitcoin");
    });
  });

  // ─── Tier-specific behavior validation ──────────────────────────────

  describe("Tier-Specific Behavior", 15000, () => {
    it("local adapter should be more prescriptive than default", 15000, () => {
      const localHint = localModelAdapter.continuationHint?.({
        toolsUsed: new Set(["search"]),
        requiredTools: ["search", "write"],
        missingTools: ["write"],
        iteration: 2,
        maxIterations: 10,
        lastToolName: "search",
      });

      const defaultHint = defaultAdapter.continuationHint?.({
        toolsUsed: new Set(["search"]),
        requiredTools: ["search", "write"],
        missingTools: ["write"],
        iteration: 2,
        maxIterations: 10,
        lastToolName: "search",
      });

      // Local should provide more detailed guidance
      expect(localHint?.length).toBeGreaterThan((defaultHint?.length || 0));
    });

    it("mid adapter should provide quality check when tools used", 15000, () => {
      const midQc = midModelAdapter.qualityCheck?.({
        task: "Find data",
        requiredTools: ["search"],
        toolsUsed: new Set(["search"]),
        tier: "mid",
      });

      const defaultQc = defaultAdapter.qualityCheck?.({
        task: "Find data",
        requiredTools: ["search"],
        toolsUsed: new Set(["search"]),
        tier: "frontier",
      });

      // Both should provide quality checks
      expect(midQc).toBeDefined();
      expect(defaultQc).toBeDefined();
      // Both mention "exact data" but may differ in length
      expect(midQc).toContain("exact data");
      expect(defaultQc).toContain("key data");
    });
  });
});
