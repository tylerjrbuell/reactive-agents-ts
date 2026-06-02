// Run: bun test packages/reasoning/tests/strategies/kernel/phases/tool-name-sanitize.test.ts
//
// Native-FC tool-name sanitization (MCP `server/tool` round-trip).
// Outbound: tool schema names are sanitized to satisfy the provider regex
//   `^[a-zA-Z0-9_-]{1,128}$`. Inbound: returned tool-call names are mapped
//   back to the canonical registered name before downstream use.
import { describe, it, expect } from "bun:test";
import { sanitizeToolName } from "../../../../src/kernel/capabilities/attend/context-utils.js";

const PROVIDER_NAME_REGEX = /^[a-zA-Z0-9_-]+$/;

describe("sanitizeToolName (outbound)", () => {
  it("replaces the MCP slash with an underscore", () => {
    expect(sanitizeToolName("github/list_commits")).toBe("github_list_commits");
  });

  it("leaves a name with no disallowed chars unchanged", () => {
    expect(sanitizeToolName("file-write")).toBe("file-write");
    expect(sanitizeToolName("web_search")).toBe("web_search");
  });

  it("produces a name matching the provider regex", () => {
    for (const raw of ["github/list_commits", "a/b/c", "weird:name.here", "x@y z"]) {
      expect(PROVIDER_NAME_REGEX.test(sanitizeToolName(raw))).toBe(true);
    }
  });

  it("is pure (idempotent on already-sanitized names)", () => {
    const once = sanitizeToolName("github/list_commits");
    expect(sanitizeToolName(once)).toBe(once);
  });
});

describe("tool-name round-trip (inbound de-sanitization)", () => {
  // Mirrors the reverse-map built in think.ts at the native-FC boundary.
  it("maps a returned sanitized name back to the canonical registered name", () => {
    const gatedToolSchemas = [
      { name: "github/list_commits" },
      { name: "file-write" },
    ];

    // Outbound: provider sees the sanitized name.
    const llmToolNames = gatedToolSchemas.map((ts) => sanitizeToolName(ts.name));
    expect(llmToolNames).toContain("github_list_commits");
    expect(llmToolNames).toContain("file-write");

    // Inbound: reverse map from the EXACT schemas offered this turn.
    const canonicalBySanitized = new Map(
      gatedToolSchemas.map((ts) => [sanitizeToolName(ts.name), ts.name] as const),
    );

    // Simulate a provider-returned tool call carrying the sanitized name.
    const accumulatedToolCalls = [{ id: "tc-1", name: "github_list_commits", input: "{}" }];
    for (const tc of accumulatedToolCalls) {
      const canon = canonicalBySanitized.get(tc.name);
      if (canon !== undefined) tc.name = canon;
    }

    expect(accumulatedToolCalls[0]!.name).toBe("github/list_commits");
  });

  it("leaves a returned name untouched when it was never sanitized away", () => {
    const gatedToolSchemas = [{ name: "file-write" }];
    const canonicalBySanitized = new Map(
      gatedToolSchemas.map((ts) => [sanitizeToolName(ts.name), ts.name] as const),
    );
    const accumulatedToolCalls = [{ id: "tc-1", name: "file-write", input: "{}" }];
    for (const tc of accumulatedToolCalls) {
      const canon = canonicalBySanitized.get(tc.name);
      if (canon !== undefined) tc.name = canon;
    }
    expect(accumulatedToolCalls[0]!.name).toBe("file-write");
  });
});

import { toProviderMessage } from "../../../../src/kernel/capabilities/attend/context-utils.js";
import type { KernelMessage } from "../../../../src/kernel/state/kernel-state.js";

describe("toProviderMessage (multi-turn replay payload)", () => {
  // Names are stored canonically in state.messages; the rendered provider
  // payload must carry the sanitized form so turn-2 replay stays consistent
  // with the (also-sanitized) outbound tools array. Regression for the
  // multi-turn MCP 400 (slash in replayed tool_use / tool_result name).
  it("sanitizes the tool_use name in a replayed assistant message", () => {
    const msg: KernelMessage = {
      role: "assistant",
      content: "calling it",
      toolCalls: [
        { id: "tc-1", name: "github/list_commits", arguments: { repo: "x" } },
      ],
    } as KernelMessage;
    const rendered = toProviderMessage(msg) as { content: { type: string; name?: string }[] };
    const toolUse = rendered.content.find((b) => b.type === "tool_use");
    expect(toolUse?.name).toBe("github_list_commits");
  });

  it("sanitizes the toolName in a replayed tool_result message", () => {
    const msg: KernelMessage = {
      role: "tool_result",
      toolCallId: "tc-1",
      toolName: "github/list_commits",
      content: "[]",
    } as KernelMessage;
    const rendered = toProviderMessage(msg) as { toolName: string };
    expect(rendered.toolName).toBe("github_list_commits");
  });

  it("leaves a canonical name with no disallowed chars unchanged on replay", () => {
    const msg: KernelMessage = {
      role: "tool_result",
      toolCallId: "tc-1",
      toolName: "file-write",
      content: "ok",
    } as KernelMessage;
    const rendered = toProviderMessage(msg) as { toolName: string };
    expect(rendered.toolName).toBe("file-write");
  });
});
