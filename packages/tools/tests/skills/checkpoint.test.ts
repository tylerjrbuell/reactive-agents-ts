import { describe, test, expect } from "bun:test";
import { Effect, Ref } from "effect";

import {
  checkpointTool,
  makeCheckpointHandler,
  type CheckpointConfig,
  type ToolParameter,
} from "../../src/index.js";

describe("checkpoint meta-tool", () => {
  // ── Tool Definition ─────────────────────────────────────────────────
  describe("checkpointTool definition", () => {
    test("has correct name", () => {
      expect(checkpointTool.name).toBe("checkpoint");
    });

    test("has label, content, and mode parameters", () => {
      const names = checkpointTool.parameters.map((p: ToolParameter) => p.name);
      expect(names).toContain("label");
      expect(names).toContain("content");
    });

    test("is low risk and builtin", () => {
      expect(checkpointTool.riskLevel).toBe("low");
      expect(checkpointTool.source).toBe("builtin");
    });

    test("has category data", () => {
      expect(checkpointTool.category).toBe("data");
    });
  });

  // ── SAVE Mode ───────────────────────────────────────────────────────
  describe("SAVE mode", () => {
    test("saves checkpoint with label and content", async () => {
      const storeRef = Ref.unsafeMake(new Map<string, string>());
      const handler = makeCheckpointHandler(storeRef);
      const result = await Effect.runPromise(
        handler({ label: "findings-1", content: "The API supports pagination via cursor tokens." }),
      );
      expect(result).toMatchObject({
        saved: true,
        label: "findings-1",
      });
    });

    test("overwrites existing checkpoint with same label", async () => {
      const storeRef = Ref.unsafeMake(new Map<string, string>());
      const handler = makeCheckpointHandler(storeRef);
      await Effect.runPromise(handler({ label: "draft", content: "v1" }));
      await Effect.runPromise(handler({ label: "draft", content: "v2" }));
      const result = await Effect.runPromise(handler({ label: "draft" }));
      expect(result).toMatchObject({ content: "v2" });
    });

    test("stores content bytes in response", async () => {
      const storeRef = Ref.unsafeMake(new Map<string, string>());
      const handler = makeCheckpointHandler(storeRef);
      const content = "Important finding about the data schema. ".repeat(10);
      const result = (await Effect.runPromise(
        handler({ label: "bytes-test", content }),
      )) as { bytes: number };
      expect(result.bytes).toBe(content.length);
    });
  });

  // ── RETRIEVE Mode ───────────────────────────────────────────────────
  describe("RETRIEVE mode", () => {
    test("retrieves saved checkpoint by label", async () => {
      const storeRef = Ref.unsafeMake(new Map<string, string>());
      const handler = makeCheckpointHandler(storeRef);
      await Effect.runPromise(
        handler({ label: "key-insight", content: "Rate limits are 100 req/min" }),
      );
      const result = await Effect.runPromise(handler({ label: "key-insight" }));
      expect(result).toMatchObject({
        label: "key-insight",
        content: "Rate limits are 100 req/min",
      });
    });

    test("returns not-found for missing label", async () => {
      const storeRef = Ref.unsafeMake(new Map<string, string>());
      const handler = makeCheckpointHandler(storeRef);
      const result = await Effect.runPromise(handler({ label: "nonexistent" }));
      expect(result).toMatchObject({ found: false, label: "nonexistent" });
    });
  });

  // ── LIST Mode ───────────────────────────────────────────────────────
  describe("LIST mode", () => {
    test("lists all checkpoints", async () => {
      const storeRef = Ref.unsafeMake(new Map<string, string>());
      const handler = makeCheckpointHandler(storeRef);
      await Effect.runPromise(handler({ label: "a", content: "alpha" }));
      await Effect.runPromise(handler({ label: "b", content: "bravo" }));
      const result = (await Effect.runPromise(handler({}))) as {
        entries: Array<{ label: string; bytes: number }>;
        count: number;
      };
      expect(result.count).toBe(2);
      expect(result.entries).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ label: "a" }),
          expect.objectContaining({ label: "b" }),
        ]),
      );
    });

    test("returns empty list when no checkpoints exist", async () => {
      const storeRef = Ref.unsafeMake(new Map<string, string>());
      const handler = makeCheckpointHandler(storeRef);
      const result = (await Effect.runPromise(handler({}))) as {
        entries: unknown[];
        count: number;
      };
      expect(result.count).toBe(0);
      expect(result.entries).toEqual([]);
    });
  });

  // ── Config ──────────────────────────────────────────────────────────
  describe("config", () => {
    test("respects maxEntries limit", async () => {
      const storeRef = Ref.unsafeMake(new Map<string, string>());
      const config: CheckpointConfig = { maxEntries: 2 };
      const handler = makeCheckpointHandler(storeRef, config);

      await Effect.runPromise(handler({ label: "a", content: "1" }));
      await Effect.runPromise(handler({ label: "b", content: "2" }));
      await Effect.runPromise(handler({ label: "c", content: "3" }));

      const result = (await Effect.runPromise(handler({}))) as {
        count: number;
        entries: Array<{ label: string }>;
      };
      // oldest entry evicted
      expect(result.count).toBe(2);
      const labels = result.entries.map((e) => e.label);
      expect(labels).not.toContain("a");
      expect(labels).toContain("b");
      expect(labels).toContain("c");
    });

    test("respects previewLength in list", async () => {
      const storeRef = Ref.unsafeMake(new Map<string, string>());
      const config: CheckpointConfig = { previewLength: 10 };
      const handler = makeCheckpointHandler(storeRef, config);
      await Effect.runPromise(
        handler({ label: "long", content: "A".repeat(100) }),
      );
      const result = (await Effect.runPromise(handler({}))) as {
        entries: Array<{ preview: string }>;
      };
      expect(result.entries[0].preview.length).toBe(10);
    });
  });

  // ── Separate Store from Recall ──────────────────────────────────────
  describe("store isolation", () => {
    test("checkpoint store is independent from recall store", async () => {
      const checkpointStore = Ref.unsafeMake(new Map<string, string>());
      const recallStore = Ref.unsafeMake(new Map<string, string>());

      const checkpointHandler = makeCheckpointHandler(checkpointStore);

      // Save to checkpoint
      await Effect.runPromise(
        checkpointHandler({ label: "finding", content: "checkpoint data" }),
      );

      // Recall store should be empty
      const recallState = await Effect.runPromise(Ref.get(recallStore));
      expect(recallState.size).toBe(0);

      // Checkpoint store should have data
      const checkpointState = await Effect.runPromise(Ref.get(checkpointStore));
      expect(checkpointState.size).toBe(1);
    });
  });
});
