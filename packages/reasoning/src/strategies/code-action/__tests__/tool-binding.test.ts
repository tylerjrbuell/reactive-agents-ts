import { describe, it, expect } from "bun:test";
import { generateToolBindings } from "../tool-binding.js";
import type { ToolSpec } from "../tool-binding.js";

const mockTools: ToolSpec[] = [
  {
    name: "web_search",
    description: "Search the web",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        maxResults: { type: "number", description: "Max results" },
      },
      required: ["query"],
    },
  },
  {
    name: "read_file",
    description: "Read a file from disk",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path" },
        encoding: { type: "string", description: "Encoding (default: utf-8)" },
      },
      required: ["path"],
    },
  },
];

describe("generateToolBindings", () => {
  it("generates async function signatures for each tool", () => {
    const bindings = generateToolBindings(mockTools);
    expect(bindings).toContain("async function web_search");
    expect(bindings).toContain("async function read_file");
  });

  // 2026-07-11 probe p7: every REAL builtin is hyphenated. Declaring
  // `async function file-write(...)` teaches the model syntactically invalid
  // JS — the sandbox then can't parse the calls it was told to make.
  it("declares hyphenated tool names under sanitized JS identifiers", () => {
    const bindings = generateToolBindings([
      {
        name: "file-write",
        description: "Write a file",
        parameters: {
          type: "object",
          properties: { path: { type: "string" }, content: { type: "string" } },
          required: ["path", "content"],
        },
      },
    ]);
    expect(bindings).toContain("async function file_write");
    expect(bindings).not.toContain("function file-write");
    // The doc line names the underlying tool so the mapping stays visible.
    expect(bindings).toContain("file-write");
  });

  it("includes required params without ?", () => {
    const bindings = generateToolBindings(mockTools);
    expect(bindings).toContain("query: string");
    expect(bindings).toContain("path: string");
  });

  it("marks optional params with ?", () => {
    const bindings = generateToolBindings(mockTools);
    expect(bindings).toContain("maxResults?: number");
    expect(bindings).toContain("encoding?: string");
  });

  it("returns Promise<unknown> for each function", () => {
    const bindings = generateToolBindings(mockTools);
    const matches = bindings.match(/Promise<unknown>/g);
    expect(matches?.length).toBe(2);
  });
});
