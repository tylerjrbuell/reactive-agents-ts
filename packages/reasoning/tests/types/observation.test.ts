// File: tests/types/observation.test.ts
import { describe, it, expect } from "bun:test";
import { Schema } from "effect";
import {
  ObservationResultSchema,
  categorizeToolName,
  deriveResultKind,
} from "../../src/types/observation.js";
import type { ObservationResult, ObservationCategory } from "../../src/types/observation.js";

describe("ObservationResult schema", () => {
  it("round-trips a valid observation", () => {
    const obs: ObservationResult = {
      success: true,
      toolName: "file-write",
      displayText: "Written to ./output.md",
      category: "file-write",
      resultKind: "side-effect",
      preserveOnCompaction: false,
    };
    const encoded = Schema.encodeSync(ObservationResultSchema)(obs);
    const decoded = Schema.decodeSync(ObservationResultSchema)(encoded);
    expect(decoded).toEqual(obs);
  });

  it("rejects invalid category", () => {
    expect(() =>
      Schema.decodeSync(ObservationResultSchema)({
        success: true,
        toolName: "x",
        displayText: "y",
        category: "invalid-category",
        resultKind: "data",
        preserveOnCompaction: false,
      }),
    ).toThrow();
  });
});

describe("categorizeToolName", () => {
  it("maps built-in tool names", () => {
    expect(categorizeToolName("file-write")).toBe("file-write");
    expect(categorizeToolName("file-read")).toBe("file-read");
    expect(categorizeToolName("web-search")).toBe("web-search");
    expect(categorizeToolName("http-get")).toBe("http-get");
    expect(categorizeToolName("code-execute")).toBe("code-execute");
    expect(categorizeToolName("scratchpad-write")).toBe("scratchpad");
    expect(categorizeToolName("scratchpad-read")).toBe("scratchpad");
  });

  it("maps agent-* prefix to agent-delegate", () => {
    expect(categorizeToolName("agent-researcher")).toBe("agent-delegate");
    expect(categorizeToolName("agent-writer")).toBe("agent-delegate");
  });

  it("maps unknown tools to custom", () => {
    expect(categorizeToolName("my-custom-tool")).toBe("custom");
    expect(categorizeToolName("database-query")).toBe("custom");
  });
});

describe("deriveResultKind", () => {
  it("returns error for failed results", () => {
    expect(deriveResultKind("file-write", false)).toBe("error");
    expect(deriveResultKind("web-search", false)).toBe("error");
  });

  it("returns side-effect for file-write, code-execute, scratchpad", () => {
    expect(deriveResultKind("file-write", true)).toBe("side-effect");
    expect(deriveResultKind("code-execute", true)).toBe("side-effect");
    expect(deriveResultKind("scratchpad", true)).toBe("side-effect");
  });

  it("returns data for read/search/http tools", () => {
    expect(deriveResultKind("file-read", true)).toBe("data");
    expect(deriveResultKind("web-search", true)).toBe("data");
    expect(deriveResultKind("http-get", true)).toBe("data");
    expect(deriveResultKind("custom", true)).toBe("data");
  });
});
