// Run: bun test packages/core/tests/task-current-turn.test.ts --timeout 15000
import { describe, expect, it } from "bun:test";
import { Schema } from "effect";
import { TaskMetadataSchema, TaskCurrentTurnSchema } from "../src/index.js";

describe("TaskMetadata.currentTurn", () => {
  it("is optional (existing metadata still decodes)", () => {
    expect(Schema.decodeUnknownSync(TaskMetadataSchema)({})).toEqual({});
  });
  it("accepts text and typed-part content", () => {
    const text = { content: "hi", priorTurnCount: 2 };
    const parts = {
      content: [
        { type: "text", text: "see" },
        { type: "image", source: { type: "base64", media_type: "image/png", data: "x" } },
      ],
    };
    expect(Schema.decodeUnknownSync(TaskCurrentTurnSchema)(text)).toEqual(text);
    expect(Schema.decodeUnknownSync(TaskMetadataSchema)({ currentTurn: parts }).currentTurn).toBeDefined();
  });
  it("rejects a turn with no content", () => {
    expect(() => Schema.decodeUnknownSync(TaskMetadataSchema)({ currentTurn: {} })).toThrow();
  });
});
