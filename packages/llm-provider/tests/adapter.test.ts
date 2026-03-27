import { describe, it, expect } from "bun:test";
import { localModelAdapter, defaultAdapter, selectAdapter } from "../src/adapter.js";

describe("ProviderAdapter", () => {
  describe("selectAdapter", () => {
    it("returns localModelAdapter for local tier", () => {
      const adapter = selectAdapter({ supportsToolCalling: true }, "local");
      expect(adapter).toBe(localModelAdapter);
    });

    it("returns defaultAdapter for frontier tier", () => {
      const adapter = selectAdapter({ supportsToolCalling: true }, "frontier");
      expect(adapter).toBe(defaultAdapter);
    });

    it("returns defaultAdapter for mid tier", () => {
      const adapter = selectAdapter({ supportsToolCalling: true }, "mid");
      expect(adapter).toBe(defaultAdapter);
    });

    it("returns defaultAdapter when tier is undefined", () => {
      const adapter = selectAdapter({ supportsToolCalling: true });
      expect(adapter).toBe(defaultAdapter);
    });
  });

  describe("localModelAdapter.continuationHint", () => {
    it("returns synthesis hint after search when file-write is missing", () => {
      const hint = localModelAdapter.continuationHint!({
        toolsUsed: new Set(["web-search"]),
        requiredTools: ["web-search", "file-write"],
        missingTools: ["file-write"],
        iteration: 3,
        maxIterations: 10,
        lastToolName: "web-search",
        lastToolResultPreview: "Search results...",
      });
      expect(hint).toContain("file-write");
      expect(hint).toContain("synthesize");
      expect(hint).toContain("Do NOT search again");
    });

    it("returns synthesis hint after http call when file-write is missing", () => {
      const hint = localModelAdapter.continuationHint!({
        toolsUsed: new Set(["http-client"]),
        requiredTools: ["http-client", "file-write"],
        missingTools: ["file-write"],
        iteration: 2,
        maxIterations: 10,
        lastToolName: "http-client",
        lastToolResultPreview: "HTTP response...",
      });
      expect(hint).toContain("file-write");
      expect(hint).toContain("synthesize");
    });

    it("returns undefined when no missing tools", () => {
      const hint = localModelAdapter.continuationHint!({
        toolsUsed: new Set(["web-search", "file-write"]),
        requiredTools: ["web-search", "file-write"],
        missingTools: [],
        iteration: 5,
        maxIterations: 10,
      });
      expect(hint).toBeUndefined();
    });

    it("adds urgency when near max iterations", () => {
      const hint = localModelAdapter.continuationHint!({
        toolsUsed: new Set(["web-search"]),
        requiredTools: ["web-search", "file-write"],
        missingTools: ["file-write"],
        iteration: 8,
        maxIterations: 10,
        lastToolName: "web-search",
      });
      expect(hint).toContain("urgent");
    });

    it("returns single-tool hint when only one tool is missing and last tool is not search", () => {
      const hint = localModelAdapter.continuationHint!({
        toolsUsed: new Set(["summarize"]),
        requiredTools: ["summarize", "send-email"],
        missingTools: ["send-email"],
        iteration: 2,
        maxIterations: 10,
        lastToolName: "summarize",
      });
      expect(hint).toContain("send-email");
      expect(hint).toContain("Your next step");
    });

    it("returns ordered list hint when multiple tools are missing", () => {
      const hint = localModelAdapter.continuationHint!({
        toolsUsed: new Set([]),
        requiredTools: ["web-search", "analyze", "file-write"],
        missingTools: ["web-search", "analyze", "file-write"],
        iteration: 1,
        maxIterations: 10,
      });
      expect(hint).toContain("web-search");
      expect(hint).toContain("analyze");
      expect(hint).toContain("file-write");
      expect(hint).toContain("in order");
    });
  });

  describe("localModelAdapter.systemPromptPatch", () => {
    it("appends multi-step instruction for local tier", () => {
      const patched = localModelAdapter.systemPromptPatch!("Base prompt.", "local");
      expect(patched).toContain("Base prompt.");
      expect(patched).toContain("IMPORTANT");
      expect(patched).toContain("ALL steps");
    });

    it("returns undefined for non-local tier", () => {
      const result = localModelAdapter.systemPromptPatch!("Base prompt.", "frontier");
      expect(result).toBeUndefined();
    });

    it("returns undefined for mid tier", () => {
      const result = localModelAdapter.systemPromptPatch!("Base prompt.", "mid");
      expect(result).toBeUndefined();
    });
  });

  describe("defaultAdapter", () => {
    it("has no continuationHint", () => {
      expect(defaultAdapter.continuationHint).toBeUndefined();
    });

    it("has no systemPromptPatch", () => {
      expect(defaultAdapter.systemPromptPatch).toBeUndefined();
    });
  });
});
