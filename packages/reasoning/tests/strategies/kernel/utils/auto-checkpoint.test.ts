import { describe, test, expect } from "bun:test";
import { Effect, Ref } from "effect";

import {
  shouldAutoCheckpoint,
  buildAutoCheckpointContent,
  autoCheckpoint,
  AUTO_CHECKPOINT_OFFSET,
} from "../../../../src/kernel/loop/auto-checkpoint.js";

describe("auto-checkpoint before pressure gate", () => {
  // ── shouldAutoCheckpoint ────────────────────────────────────────────
  describe("shouldAutoCheckpoint", () => {
    test("returns true when utilization is in the soft zone (5% below hard gate)", () => {
      // frontier hard gate = 0.95, so soft gate = 0.90
      expect(
        shouldAutoCheckpoint({
          estimatedTokens: 9100,
          maxTokens: 10000,
          tier: "frontier",
        }),
      ).toBe(true);
    });

    test("returns false when utilization is below the soft zone", () => {
      // frontier soft gate = 0.90 → at 85% should not fire
      expect(
        shouldAutoCheckpoint({
          estimatedTokens: 8500,
          maxTokens: 10000,
          tier: "frontier",
        }),
      ).toBe(false);
    });

    test("returns false when utilization is above the hard gate (pressure gate handles that)", () => {
      // frontier hard gate = 0.95 → at 96% the hard gate already fired
      expect(
        shouldAutoCheckpoint({
          estimatedTokens: 9600,
          maxTokens: 10000,
          tier: "frontier",
        }),
      ).toBe(false);
    });

    test("uses tier-specific thresholds (local hard=0.80, soft=0.75)", () => {
      // local hard = 0.80, soft = 0.75
      expect(
        shouldAutoCheckpoint({
          estimatedTokens: 7700,
          maxTokens: 10000,
          tier: "local",
        }),
      ).toBe(true);
    });

    test("does not fire if already checkpointed flag is set", () => {
      expect(
        shouldAutoCheckpoint({
          estimatedTokens: 9100,
          maxTokens: 10000,
          tier: "frontier",
          alreadyCheckpointed: true,
        }),
      ).toBe(false);
    });

    test("defaults to mid tier when tier is not specified", () => {
      // mid hard = 0.85, soft = 0.80
      expect(
        shouldAutoCheckpoint({
          estimatedTokens: 8100,
          maxTokens: 10000,
        }),
      ).toBe(true);
    });

    test("offset constant is 0.05", () => {
      expect(AUTO_CHECKPOINT_OFFSET).toBe(0.05);
    });
  });

  // ── buildAutoCheckpointContent ──────────────────────────────────────
  describe("buildAutoCheckpointContent", () => {
    test("collects successful non-meta observations", () => {
      const steps = [
        {
          type: "observation" as const,
          content: "search result data",
          metadata: {
            observationResult: {
              success: true,
              toolName: "web-search",
              displayText: "search result data",
              category: "data_retrieval" as const,
              resultKind: "data" as const,
              preserveOnCompaction: true,
            },
          },
        },
        {
          type: "observation" as const,
          content: "recall note",
          metadata: {
            observationResult: {
              success: true,
              toolName: "recall",
              displayText: "recall note",
              category: "data_retrieval" as const,
              resultKind: "data" as const,
              preserveOnCompaction: false,
            },
          },
        },
        {
          type: "thought" as const,
          content: "thinking about things",
        },
      ];
      const result = buildAutoCheckpointContent(steps as any);
      expect(result).toContain("search result data");
      expect(result).not.toContain("recall note"); // meta-tool excluded
      expect(result).not.toContain("thinking about things"); // not observation
    });

    test("returns empty string when no useful observations exist", () => {
      const steps = [
        { type: "thought" as const, content: "just thinking" },
      ];
      const result = buildAutoCheckpointContent(steps as any);
      expect(result).toBe("");
    });

    test("includes tool name as section header", () => {
      const steps = [
        {
          type: "observation" as const,
          content: "file contents",
          metadata: {
            observationResult: {
              success: true,
              toolName: "file-read",
              displayText: "file contents",
              category: "data_retrieval" as const,
              resultKind: "data" as const,
              preserveOnCompaction: true,
            },
          },
        },
      ];
      const result = buildAutoCheckpointContent(steps as any);
      expect(result).toContain("file-read");
      expect(result).toContain("file contents");
    });

    test("excludes failed observations", () => {
      const steps = [
        {
          type: "observation" as const,
          content: "error message",
          metadata: {
            observationResult: {
              success: false,
              toolName: "web-search",
              displayText: "error message",
              category: "data_retrieval" as const,
              resultKind: "error" as const,
              preserveOnCompaction: false,
            },
          },
        },
      ];
      const result = buildAutoCheckpointContent(steps as any);
      expect(result).toBe("");
    });
  });

  // ── autoCheckpoint (Effect) ─────────────────────────────────────────
  describe("autoCheckpoint", () => {
    test("saves content to checkpoint store with auto-checkpoint label", async () => {
      const store = Ref.unsafeMake(new Map<string, string>());
      const steps = [
        {
          type: "observation" as const,
          content: "important finding",
          metadata: {
            observationResult: {
              success: true,
              toolName: "web-search",
              displayText: "important finding",
              category: "data_retrieval" as const,
              resultKind: "data" as const,
              preserveOnCompaction: true,
            },
          },
        },
      ];
      const saved = await Effect.runPromise(autoCheckpoint(store, steps as any));
      expect(saved).toBe(true);

      const storeData = await Effect.runPromise(Ref.get(store));
      expect(storeData.has("_auto_checkpoint")).toBe(true);
      expect(storeData.get("_auto_checkpoint")).toContain("important finding");
    });

    test("returns false when no content to checkpoint", async () => {
      const store = Ref.unsafeMake(new Map<string, string>());
      const saved = await Effect.runPromise(autoCheckpoint(store, []));
      expect(saved).toBe(false);
    });
  });
});
