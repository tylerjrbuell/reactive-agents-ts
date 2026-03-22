// File: tests/sub-agent-fixes.test.ts
// Tests for the three sub-agent fixes:
// 1. Auto-include scratchpad tools
// 2. Cap maxIterations to 4
// 3. Forward scratchpad keys with sub: prefix
import { describe, it, expect } from "bun:test";
import {
  createSubAgentExecutor,
  ALWAYS_INCLUDE_TOOLS,
} from "../src/adapters/agent-tool-adapter.js";
import type { SubAgentConfig } from "../src/adapters/agent-tool-adapter.js";

// ─── Fix 1: Auto-include scratchpad tools ───

describe("Fix 1: auto-include scratchpad tools", () => {
  it("exports ALWAYS_INCLUDE_TOOLS containing scratchpad-read and scratchpad-write", () => {
    expect(ALWAYS_INCLUDE_TOOLS).toContain("scratchpad-read");
    expect(ALWAYS_INCLUDE_TOOLS).toContain("scratchpad-write");
  });

  it("auto-includes scratchpad tools in sub-agent tool list even when not specified", async () => {
    let capturedOpts: any;
    const executor = createSubAgentExecutor(
      { name: "no-tools-agent", tools: ["web-search"] },
      async (opts) => {
        capturedOpts = opts;
        return { output: "ok", success: true, tokensUsed: 0 };
      },
      0,
    );
    await executor("test");
    expect(capturedOpts.allowedTools).toContain("scratchpad-read");
    expect(capturedOpts.allowedTools).toContain("scratchpad-write");
    // Original tool should still be present
    expect(capturedOpts.allowedTools).toContain("web-search");
  });

  it("does not duplicate scratchpad tools when already in tool list", async () => {
    let capturedOpts: any;
    const executor = createSubAgentExecutor(
      { name: "dup-test-agent", tools: ["scratchpad-read", "scratchpad-write", "file-write"] },
      async (opts) => {
        capturedOpts = opts;
        return { output: "ok", success: true, tokensUsed: 0 };
      },
      0,
    );
    await executor("test");
    const scratchReadCount = capturedOpts.allowedTools.filter(
      (t: string) => t === "scratchpad-read"
    ).length;
    const scratchWriteCount = capturedOpts.allowedTools.filter(
      (t: string) => t === "scratchpad-write"
    ).length;
    expect(scratchReadCount).toBe(1);
    expect(scratchWriteCount).toBe(1);
  });

  it("passes undefined allowedTools when config.tools is undefined (all tools allowed)", async () => {
    let capturedOpts: any;
    const executor = createSubAgentExecutor(
      { name: "all-tools-agent" }, // no tools restriction
      async (opts) => {
        capturedOpts = opts;
        return { output: "ok", success: true, tokensUsed: 0 };
      },
      0,
    );
    await executor("test");
    // When no tools restriction, allowedTools should be undefined (all tools pass through)
    expect(capturedOpts.allowedTools).toBeUndefined();
  });

  it("adds scratchpad tools to a restricted single-tool list", async () => {
    let capturedOpts: any;
    const executor = createSubAgentExecutor(
      { name: "single-tool-agent", tools: ["file-read"] },
      async (opts) => {
        capturedOpts = opts;
        return { output: "ok", success: true, tokensUsed: 0 };
      },
      0,
    );
    await executor("test");
    expect(capturedOpts.allowedTools).toHaveLength(3); // file-read + scratchpad-read + scratchpad-write
    expect(capturedOpts.allowedTools).toContain("file-read");
    expect(capturedOpts.allowedTools).toContain("scratchpad-read");
    expect(capturedOpts.allowedTools).toContain("scratchpad-write");
  });
});

// ─── Fix 2: Cap maxIterations to 3 ───

describe("Fix 2: cap sub-agent maxIterations to 3", () => {
  it("caps sub-agent maxIterations to 3 even when parent has higher max", async () => {
    let capturedOpts: any;
    const executor = createSubAgentExecutor(
      { name: "high-iter-agent", maxIterations: 20 },
      async (opts) => {
        capturedOpts = opts;
        return { output: "ok", success: true, tokensUsed: 0 };
      },
      0,
    );
    await executor("test");
    expect(capturedOpts.maxIterations).toBe(3);
  });

  it("uses 3 as the default maxIterations", async () => {
    let capturedOpts: any;
    const executor = createSubAgentExecutor(
      { name: "default-iter-agent" },
      async (opts) => {
        capturedOpts = opts;
        return { output: "ok", success: true, tokensUsed: 0 };
      },
      0,
    );
    await executor("test");
    expect(capturedOpts.maxIterations).toBe(3);
  });

  it("preserves lower maxIterations values below the cap", async () => {
    let capturedOpts: any;
    const executor = createSubAgentExecutor(
      { name: "low-iter-agent", maxIterations: 2 },
      async (opts) => {
        capturedOpts = opts;
        return { output: "ok", success: true, tokensUsed: 0 };
      },
      0,
    );
    await executor("test");
    expect(capturedOpts.maxIterations).toBe(2);
  });

  it("caps exactly at the boundary (maxIterations=3 stays 3)", async () => {
    let capturedOpts: any;
    const executor = createSubAgentExecutor(
      { name: "boundary-agent", maxIterations: 3 },
      async (opts) => {
        capturedOpts = opts;
        return { output: "ok", success: true, tokensUsed: 0 };
      },
      0,
    );
    await executor("test");
    expect(capturedOpts.maxIterations).toBe(3);
  });

  it("caps maxIterations=100 down to 3", async () => {
    let capturedOpts: any;
    const executor = createSubAgentExecutor(
      { name: "huge-iter-agent", maxIterations: 100 },
      async (opts) => {
        capturedOpts = opts;
        return { output: "ok", success: true, tokensUsed: 0 };
      },
      0,
    );
    await executor("test");
    expect(capturedOpts.maxIterations).toBe(3);
  });
});

// ─── Fix 3: Forward scratchpad keys with sub: prefix ───

describe("Fix 3: forward scratchpad keys to parent", () => {
  it("forwards scratchpad keys with sub:<agentName>: prefix when writer is provided", async () => {
    const forwardedEntries: Record<string, string> = {};
    const writer = (key: string, value: string) => {
      forwardedEntries[key] = value;
    };

    const subScratchpad = new Map<string, string>([
      ["findings", "The sky is blue"],
      ["plan", "Step 1: research, Step 2: summarize"],
    ]);

    const executor = createSubAgentExecutor(
      { name: "scratchpad-agent" },
      async () => ({
        output: "Done",
        success: true,
        tokensUsed: 10,
        scratchpadEntries: subScratchpad,
      }),
      0,
      undefined,
      writer,
    );

    await executor("test");

    expect(forwardedEntries["sub:scratchpad-agent:findings"]).toBe("The sky is blue");
    expect(forwardedEntries["sub:scratchpad-agent:plan"]).toBe("Step 1: research, Step 2: summarize");
  });

  it("includes forwarded key names in SubAgentResult.forwardedScratchpadKeys", async () => {
    const subScratchpad = new Map<string, string>([
      ["result", "42"],
    ]);

    const executor = createSubAgentExecutor(
      { name: "result-agent" },
      async () => ({
        output: "Done",
        success: true,
        tokensUsed: 5,
        scratchpadEntries: subScratchpad,
      }),
      0,
      undefined,
      () => {},
    );

    const result = await executor("test");
    expect(result.forwardedScratchpadKeys).toEqual(["sub:result-agent:result"]);
  });

  it("appends forwarded key list to summary for parent agent visibility", async () => {
    const subScratchpad = new Map<string, string>([
      ["summary", "Done"],
    ]);

    const executor = createSubAgentExecutor(
      { name: "visibility-agent" },
      async () => ({
        output: "Task complete",
        success: true,
        tokensUsed: 5,
        scratchpadEntries: subScratchpad,
      }),
      0,
      undefined,
      () => {},
    );

    const result = await executor("test");
    expect(result.summary).toContain("Scratchpad keys forwarded to parent");
    expect(result.summary).toContain("sub:visibility-agent:summary");
  });

  it("does not forward keys when no parentScratchpadWriter is provided", async () => {
    const subScratchpad = new Map<string, string>([
      ["key1", "value1"],
    ]);

    const executor = createSubAgentExecutor(
      { name: "no-writer-agent" },
      async () => ({
        output: "Done",
        success: true,
        tokensUsed: 5,
        scratchpadEntries: subScratchpad,
      }),
      0,
      // No parentContextProvider
      // No parentScratchpadWriter
    );

    const result = await executor("test");
    expect(result.forwardedScratchpadKeys).toBeUndefined();
    expect(result.summary).not.toContain("Scratchpad keys forwarded");
  });

  it("handles empty scratchpad entries gracefully", async () => {
    const forwardedEntries: Record<string, string> = {};
    const executor = createSubAgentExecutor(
      { name: "empty-scratch-agent" },
      async () => ({
        output: "Done",
        success: true,
        tokensUsed: 5,
        scratchpadEntries: new Map(),
      }),
      0,
      undefined,
      (k, v) => { forwardedEntries[k] = v; },
    );

    const result = await executor("test");
    expect(Object.keys(forwardedEntries)).toHaveLength(0);
    expect(result.forwardedScratchpadKeys).toBeUndefined();
  });

  it("handles missing scratchpadEntries in result gracefully", async () => {
    const forwardedEntries: Record<string, string> = {};
    const executor = createSubAgentExecutor(
      { name: "no-scratchpad-agent" },
      async () => ({
        output: "Done",
        success: true,
        tokensUsed: 5,
        // No scratchpadEntries field
      }),
      0,
      undefined,
      (k, v) => { forwardedEntries[k] = v; },
    );

    const result = await executor("test");
    expect(Object.keys(forwardedEntries)).toHaveLength(0);
    expect(result.forwardedScratchpadKeys).toBeUndefined();
  });

  it("uses sub-agent name correctly in forwarded key prefix", async () => {
    const forwardedKeys: string[] = [];
    const subScratchpad = new Map<string, string>([["x", "1"], ["y", "2"]]);

    const executor = createSubAgentExecutor(
      { name: "my-special-agent" },
      async () => ({
        output: "ok",
        success: true,
        tokensUsed: 0,
        scratchpadEntries: subScratchpad,
      }),
      0,
      undefined,
      (k) => forwardedKeys.push(k),
    );

    await executor("test");
    expect(forwardedKeys.every((k) => k.startsWith("sub:my-special-agent:"))).toBe(true);
  });
});
