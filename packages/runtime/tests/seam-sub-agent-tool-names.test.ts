// Run: bun test packages/runtime/tests/seam-sub-agent-tool-names.test.ts --timeout 30000
//
// Seam pin: the tool names a parent hands a sub-agent are resolved against the
// child's real tools before they become its allowedTools / requiredTools.
//
// Census 2026-11-10: all 19 wrong-name failures were depth-1 children. The
// parent passed `umami_get_website_stats`; the child allowlist kept it verbatim,
// matched nothing, and the child ran with an empty toolbox (trace
// 01M6KBVJTC6JEPNWDNZKGMBA74). Red-on-cut: pass `t.tools` straight to
// `computeEffectiveTools` in sub-agent-executor.ts and the integration cases fail
// (the proxied MCP tool is filtered out of the child, and an all-unknown spawn
// starts a doomed child instead of refusing).
import { describe, expect, it } from "bun:test";
import { Effect } from "effect";
import * as toolsMod from "@reactive-agents/tools";
import {
  resolveSubAgentToolNames,
  subAgentToolUniverse,
  unresolvedSubAgentToolsResult,
  withSubAgentToolNote,
} from "../src/builder/build-effect/sub-agent-tool-names.js";
import {
  buildSubAgentTask,
  type SubAgentExecutorDeps,
} from "../src/builder/build-effect/sub-agent-executor.js";
import { createLocalAgentToolRegistration } from "../src/builder/build-effect/local-agent-tools.js";
import type { TestTurn } from "@reactive-agents/llm-provider";

describe("resolveSubAgentToolNames (pure)", () => {
  it("resolves a `_` spelling of an MCP tool to the real `/` name", () => {
    const r = resolveSubAgentToolNames(
      ["umami_get_website_stats"],
      subAgentToolUniverse(["umami/get_website_stats"]),
    );
    expect(r.tools).toEqual(["umami/get_website_stats"]);
    expect(r.corrected).toEqual([{ from: "umami_get_website_stats", to: "umami/get_website_stats" }]);
    expect(r.unresolved).toEqual([]);
  });

  it("drops an ambiguous name instead of guessing", () => {
    const r = resolveSubAgentToolNames(["a_b"], subAgentToolUniverse(["a/b", "a-b"]));
    expect(r.tools).toEqual([]);
    expect(r.unresolved).toEqual(["a_b"]);
  });

  it("drops an unknown name and keeps the ones that resolve", () => {
    const r = resolveSubAgentToolNames(
      ["web_search", "no-such-tool"],
      subAgentToolUniverse(),
    );
    expect(r.tools).toEqual(["web-search"]);
    expect(r.unresolved).toEqual(["no-such-tool"]);
    const noted = withSubAgentToolNote(
      { subAgentName: "c", success: true, summary: "ok", tokensUsed: 1 },
      r,
    );
    expect(noted.summary).toContain("web_search -> web-search");
    expect(noted.summary).toContain("dropped");
    expect(noted.summary).toContain("no-such-tool");
  });

  it("still expands a toolset alias like builtins does", () => {
    const r = resolveSubAgentToolNames(["web"], subAgentToolUniverse());
    expect(r.tools).toContain("web-search");
    expect(r.unresolved).toEqual([]);
  });

  it("the all-unknown refusal names the unknown tools and lists available ones", () => {
    const universe = subAgentToolUniverse(["umami/get_website_stats"]);
    const r = resolveSubAgentToolNames(["nope"], universe);
    const res = unresolvedSubAgentToolsResult("child", r, universe);
    expect(res.success).toBe(false);
    expect(res.completionStatus).toBe("failed");
    expect(res.summary).toContain("nope");
    expect(res.summary).toContain("umami/get_website_stats");
    expect(res.summary).not.toContain("final-answer");
  });
});

// ── Integration: buildSubAgentTask with a parent that has an MCP tool ─────────

const makeParent = () => {
  const calls: string[] = [];
  const service = {
    listTools: () =>
      Effect.succeed([
        {
          name: "umami/get_website_stats",
          source: "mcp",
          description: "Website stats",
          parameters: [],
          riskLevel: "low",
          timeoutMs: 10_000,
          requiresApproval: false,
        },
      ]),
    execute: (p: { toolName: string }) =>
      Effect.sync(() => {
        calls.push(p.toolName);
        return { success: true, result: "visitors: 42" };
      }),
  };
  return { calls, service };
};

const deps = (service: unknown, scenario: TestTurn[]): SubAgentExecutorDeps => ({
  parentProvider: "test",
  parentModel: "test-model",
  defaultMaxIter: 4,
  getParentToolService: () => service,
  mcpServers: [{ name: "umami", transport: "stdio", command: "true" }],
  parentReasoningOptions: undefined,
  parentEnableGuardrails: undefined,
  parentEnableObservability: undefined,
  parentObservabilityOptions: undefined,
  parentContextProfile: undefined,
  parentEnableCostTracking: undefined,
  parentTestScenario: scenario,
  parentAgentId: "parent-agent",
  getParentContext: () => undefined,
  toolsMod,
});

describe(".withAgentTool per-call tools resolve the same way", () => {
  const registration = () =>
    createLocalAgentToolRegistration(
      { name: "helper", agent: { name: "helper", maxIterations: 2 } },
      {
        toolsMod: {
          createAgentTool: toolsMod.createAgentTool,
          composeSubAgentDirectivePrompt: toolsMod.composeSubAgentDirectivePrompt,
          finalizeSubAgentResult: toolsMod.finalizeSubAgentResult,
        },
        agentId: "parent-agent",
        getParentContext: () => undefined,
      },
    );

  it("an all-unknown per-call tools list refuses without starting a child", async () => {
    const res = (await Effect.runPromise(
      registration().handler({ input: "do it", tools: ["no_such_tool"] }),
    )) as toolsMod.SubAgentResult;
    expect(res.success).toBe(false);
    expect(res.tokensUsed).toBe(0);
    expect(res.summary).toContain("no_such_tool");
    expect(res.summary).toContain("web-search");
  }, 30000);

  it("a `_` spelling is corrected and the correction is reported to the parent", async () => {
    const res = (await Effect.runPromise(
      registration().handler({ input: "do it", tools: ["web_search"] }),
    )) as toolsMod.SubAgentResult;
    expect(res.summary).toContain("web_search -> web-search");
  }, 30000);
});

describe("buildSubAgentTask resolves requested tool names", () => {
  it("a child asked for `umami_get_website_stats` gets the real `umami/get_website_stats`", async () => {
    const { calls, service } = makeParent();
    const scenario: TestTurn[] = [
      { match: "STATSCHILD", toolCall: { name: "umami/get_website_stats", args: {} } },
      { text: "Visitors: 42" },
    ];
    const res = await Effect.runPromise(
      buildSubAgentTask(
        { task: "STATSCHILD get website stats", name: "stats", tools: ["umami_get_website_stats"] },
        deps(service, scenario),
      ),
    );
    expect(calls).toContain("umami/get_website_stats");
    expect(res.success).toBe(true);
    // The child's required tool is the real name, not the model's spelling.
    expect(JSON.stringify(res.childRunLedger)).toContain('"requirementId":"tool:umami/get_website_stats"');
    expect(JSON.stringify(res.childRunLedger)).not.toContain("tool:umami_get_website_stats");
    expect(res.summary).toContain("umami_get_website_stats -> umami/get_website_stats");
  }, 30000);

  it("an all-unknown tools list refuses the spawn without starting a child", async () => {
    const { calls, service } = makeParent();
    const res = await Effect.runPromise(
      buildSubAgentTask(
        { task: "do something", name: "doomed", tools: ["no_such_tool"] },
        deps(service, [{ text: "should not run" }]),
      ),
    );
    expect(res.success).toBe(false);
    expect(res.tokensUsed).toBe(0);
    expect(res.summary).toContain("no_such_tool");
    expect(res.summary).toContain("umami/get_website_stats");
    expect(calls).toEqual([]);
  }, 30000);
});
