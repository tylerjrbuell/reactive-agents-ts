import { describe, it, expect } from "bun:test";
import { Effect, Ref } from "effect";
import {
  makeObservationResult,
  truncateForDisplay,
  executeToolCall,
  executeNativeToolCall,
  type ToolExecutionResult,
} from "../../../../src/strategies/kernel/utils/tool-execution.js";
import type { MaybeService, ToolServiceInstance } from "../../../../src/strategies/kernel/kernel-state.js";
import { scratchpadStoreRef, makeRecallHandler } from "@reactive-agents/tools";

// ── makeObservationResult ────────────────────────────────────────────────────

describe("makeObservationResult", () => {
  it("produces correct category and resultKind for file-write success", () => {
    const result = makeObservationResult("file-write", true, "✓ Written to ./out.txt");
    expect(result.success).toBe(true);
    expect(result.toolName).toBe("file-write");
    expect(result.displayText).toBe("✓ Written to ./out.txt");
    expect(result.category).toBe("file-write");
    expect(result.resultKind).toBe("side-effect");
    expect(result.preserveOnCompaction).toBe(false);
  });

  it("produces error resultKind on failure", () => {
    const result = makeObservationResult("web-search", false, "[Tool error: timeout]");
    expect(result.success).toBe(false);
    expect(result.category).toBe("web-search");
    expect(result.resultKind).toBe("error");
    expect(result.preserveOnCompaction).toBe(true);
  });

  it("produces data resultKind for data-fetching tools", () => {
    const result = makeObservationResult("web-search", true, "1. Result A: http://a.com");
    expect(result.resultKind).toBe("data");
    expect(result.preserveOnCompaction).toBe(false);
  });

  it("preserves on compaction for error category", () => {
    // Custom tool that maps to "custom" category with success=false
    const result = makeObservationResult("unknown-tool", false, "error msg");
    expect(result.preserveOnCompaction).toBe(true);
  });
});

// ── truncateForDisplay ───────────────────────────────────────────────────────

describe("truncateForDisplay", () => {
  it("returns short strings unchanged", () => {
    const short = "Hello, world!";
    expect(truncateForDisplay(short, 100)).toBe(short);
  });

  it("truncates long strings with head+tail and omitted count", () => {
    const long = "A".repeat(200);
    const result = truncateForDisplay(long, 100);
    expect(result).toContain("[...100 chars omitted...]");
    expect(result.length).toBeLessThan(200);
    // Head portion (50 chars) + tail portion (50 chars) + marker
    expect(result.startsWith("A".repeat(50))).toBe(true);
    expect(result.endsWith("A".repeat(50))).toBe(true);
  });

  it("returns exact-length strings unchanged", () => {
    const exact = "B".repeat(50);
    expect(truncateForDisplay(exact, 50)).toBe(exact);
  });
});

// ── executeToolCall ──────────────────────────────────────────────────────────

describe("executeToolCall", () => {
  const noneToolService: MaybeService<ToolServiceInstance> = { _tag: "None" };

  it("returns 'not available' message when ToolService is None", async () => {
    const result = await Effect.runPromise(
      executeToolCall(
        noneToolService,
        { tool: "web-search", input: '{"query": "test"}' },
        {},
      ),
    );
    expect(result.content).toContain("ToolService is not available");
    expect(result.content).toContain("web-search");
    expect(result.observationResult.success).toBe(false);
  });

  it("returns 'not available' for recall when ToolService is None", async () => {
    const result = await Effect.runPromise(
      executeToolCall(
        noneToolService,
        { tool: "recall", input: '{"key": "_tool_result_1"}' },
        {},
      ),
    );
    // recall is now a real tool — without ToolService it shows the not-available message
    expect(result.content).toContain("ToolService is not available");
    expect(result.observationResult.success).toBe(false);
  });

  it("executes tool call successfully with mock ToolService", async () => {
    const mockToolService: MaybeService<ToolServiceInstance> = {
      _tag: "Some",
      value: {
        execute: (_input) =>
          Effect.succeed({
            result: JSON.stringify({ data: "hello world" }),
            success: true,
          }),
        getTool: (_name) =>
          Effect.succeed({
            parameters: [{ name: "query", type: "string", required: true }],
          }),
      },
    };

    const result = await Effect.runPromise(
      executeToolCall(
        mockToolService,
        { tool: "custom-tool", input: '{"query": "test"}' },
        {},
      ),
    );
    expect(result.observationResult.success).toBe(true);
    expect(result.content).toBeTruthy();
  });

  it("enriches error with schema hint on tool execution failure", async () => {
    const mockToolService: MaybeService<ToolServiceInstance> = {
      _tag: "Some",
      value: {
        execute: (_input) => Effect.fail(new Error("Missing required field: path")),
        getTool: (_name) =>
          Effect.succeed({
            parameters: [
              { name: "path", type: "string", required: true },
              { name: "content", type: "string", required: true },
            ],
          }),
      },
    };

    const result = await Effect.runPromise(
      executeToolCall(
        mockToolService,
        { tool: "file-write", input: '{}' },
        {},
      ),
    );
    expect(result.observationResult.success).toBe(false);
    expect(result.content).toContain("Tool error");
    expect(result.content).toContain("Missing required field: path");
    expect(result.content).toContain("Expected: file-write");
    expect(result.content).toContain('"path"');
    expect(result.content).toContain('"content"');
  });

  it("falls back to plain error when getTool also fails", async () => {
    const mockToolService: MaybeService<ToolServiceInstance> = {
      _tag: "Some",
      value: {
        execute: (_input) => Effect.fail(new Error("connection refused")),
        getTool: (_name) => Effect.fail(new Error("tool registry unavailable")),
      },
    };

    const result = await Effect.runPromise(
      executeToolCall(
        mockToolService,
        { tool: "unknown-tool", input: '{"x": 1}' },
        {},
      ),
    );
    expect(result.observationResult.success).toBe(false);
    expect(result.content).toContain("Tool error: connection refused");
    // No "Expected:" suffix since getTool also failed
    expect(result.content).not.toContain("Expected:");
  });

  it("normalizes file-write output to compact form", async () => {
    const mockToolService: MaybeService<ToolServiceInstance> = {
      _tag: "Some",
      value: {
        execute: (_input) =>
          Effect.succeed({
            result: JSON.stringify({ written: true, path: "/tmp/output.txt" }),
            success: true,
          }),
        getTool: (_name) =>
          Effect.succeed({
            parameters: [{ name: "path", type: "string", required: true }],
          }),
      },
    };

    const result = await Effect.runPromise(
      executeToolCall(
        mockToolService,
        { tool: "file-write", input: '{"path": "/tmp/output.txt", "content": "hello"}' },
        {},
      ),
    );
    expect(result.observationResult.success).toBe(true);
    expect(result.content).toContain("Written to");
  });

  it("resolves plain string input to first required parameter", async () => {
    let capturedArgs: Record<string, unknown> = {};
    const mockToolService: MaybeService<ToolServiceInstance> = {
      _tag: "Some",
      value: {
        execute: (input) => {
          capturedArgs = input.arguments;
          return Effect.succeed({ result: "ok", success: true });
        },
        getTool: (_name) =>
          Effect.succeed({
            parameters: [{ name: "query", type: "string", required: true }],
          }),
      },
    };

    await Effect.runPromise(
      executeToolCall(
        mockToolService,
        { tool: "web-search", input: "effect typescript" },
        {},
      ),
    );
    expect(capturedArgs).toEqual({ query: "effect typescript" });
  });

  it("uses agentId and sessionId from config", async () => {
    let capturedAgentId = "";
    let capturedSessionId = "";
    const mockToolService: MaybeService<ToolServiceInstance> = {
      _tag: "Some",
      value: {
        execute: (input) => {
          capturedAgentId = input.agentId;
          capturedSessionId = input.sessionId;
          return Effect.succeed({ result: "ok", success: true });
        },
        getTool: (_name) =>
          Effect.succeed({
            parameters: [{ name: "query", type: "string", required: true }],
          }),
      },
    };

    await Effect.runPromise(
      executeToolCall(
        mockToolService,
        { tool: "web-search", input: '{"query": "test"}' },
        { agentId: "my-agent", sessionId: "sess-123" },
      ),
    );
    expect(capturedAgentId).toBe("my-agent");
    expect(capturedSessionId).toBe("sess-123");
  });

  it("defaults agentId and sessionId when not provided", async () => {
    let capturedAgentId = "";
    let capturedSessionId = "";
    const mockToolService: MaybeService<ToolServiceInstance> = {
      _tag: "Some",
      value: {
        execute: (input) => {
          capturedAgentId = input.agentId;
          capturedSessionId = input.sessionId;
          return Effect.succeed({ result: "ok", success: true });
        },
        getTool: (_name) =>
          Effect.succeed({
            parameters: [{ name: "query", type: "string", required: true }],
          }),
      },
    };

    await Effect.runPromise(
      executeToolCall(
        mockToolService,
        { tool: "web-search", input: '{"query": "test"}' },
        {},
      ),
    );
    expect(capturedAgentId).toBe("reasoning-agent");
    expect(capturedSessionId).toBe("reasoning-session");
  });

  it("uses shell-execute fullOutput for compression and stored recall key", async () => {
    const commits = Array.from({ length: 5 }, (_, i) => ({
      sha: `sha-${i}`,
      commit: { author: { name: `author-${i}`, date: `2026-03-${10 + i}` }, message: `msg-${i}` },
    }));
    const fullJson = JSON.stringify(commits);
    const scratchpad = new Map<string, string>();

    const mockToolService: MaybeService<ToolServiceInstance> = {
      _tag: "Some",
      value: {
        execute: (_input) =>
          Effect.succeed({
            success: true,
            result: {
              executed: true,
              output: fullJson.slice(0, 120),
              fullOutput: fullJson,
              truncated: true,
              exitCode: 0,
            },
          }),
        getTool: (_name) =>
          Effect.succeed({
            parameters: [{ name: "command", type: "string", required: true }],
          }),
      },
    };

    const result = await Effect.runPromise(
      executeToolCall(
        mockToolService,
        { tool: "shell-execute", input: '{"command":"gh api repos/x/y/commits?per_page=5"}' },
        {
          compression: { budget: 120, previewItems: 5, autoStore: true },
          scratchpad,
        },
      ),
    );

    expect(result.storedKey).toBeDefined();
    expect(result.content).toContain("Array(5)");
    expect(result.content).toContain("[4]");
    expect(scratchpad.has(result.storedKey!)).toBe(true);
    expect(scratchpad.get(result.storedKey!)!).toContain('"sha":"sha-4"');
  });
});

// ── executeNativeToolCall + scratchpadStoreRef (same Map as recall tool) ─────

describe("executeNativeToolCall recall store alignment", () => {
  it("stores overflow in scratchpadStoreRef so recall retrieves _tool_result keys", async () => {
    await Effect.runPromise(Ref.set(scratchpadStoreRef, new Map()));
    const recall = makeRecallHandler(scratchpadStoreRef);

    const commits = Array.from({ length: 5 }, (_, i) => ({
      sha: `sha-${i}`,
      commit: { author: { name: `author-${i}`, date: `2026-03-${10 + i}` }, message: `msg-${i}` },
    }));
    const fullJson = JSON.stringify(commits);

    const mockToolService: ToolServiceInstance = {
      execute: (_input) =>
        Effect.succeed({
          success: true,
          result: {
            executed: true,
            output: fullJson.slice(0, 120),
            fullOutput: fullJson,
            truncated: true,
            exitCode: 0,
          },
        }),
      getTool: (_name) =>
        Effect.succeed({
          parameters: [{ name: "command", type: "string", required: true }],
        }),
    };

    const toolCall = {
      id: "call-1",
      name: "shell-execute",
      arguments: { command: "gh api repos/x/y/commits?per_page=5" },
    };

    const execResult = await Effect.runPromise(
      Effect.gen(function* () {
        const shared = yield* Ref.get(scratchpadStoreRef);
        return yield* executeNativeToolCall(
          mockToolService,
          toolCall,
          "reasoning-agent",
          "reasoning-session",
          { compression: { budget: 120, previewItems: 5, autoStore: true }, scratchpad: shared },
        );
      }),
    );

    expect(execResult.storedKey).toBeDefined();
    const readBack = await Effect.runPromise(
      recall({ key: execResult.storedKey!, full: true } as Record<string, unknown>),
    );
    expect(readBack).not.toEqual(expect.objectContaining({ found: false }));
    expect((readBack as { content?: string }).content).toContain('"sha":"sha-4"');
  });
});
