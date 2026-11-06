// Run: bun test packages/runtime/tests/subagent/max-calls-per-tool-inheritance.test.ts --timeout 30000
//
// Sub-agents run under the parent's `.withTools({ maxCallsPerTool })` caps.
// Before this, `createLightRuntime` built the child config without the field,
// so a delegated child could call a capped tool as often as it liked.
//
// Paths pinned:
//  - spawn-agent (dynamic): the parent's caps reach the child. The model writes
//    the spawn arguments, so it has no way to loosen them.
//  - withAgentTool (static): the sub-agent's own `agent.maxCallsPerTool` is
//    merged over the parent's (own wins per tool name).
//  - the light runtime enforces whatever caps its options carry (the config
//    path both sub-agent kinds go through).
//
// Observation: `ToolCallStarted` for `file-read` on the bus. A refused call is
// never started, so the count is the number of calls that ran. Only the child
// calls `file-read`; the parent only calls `spawn-agent`.
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { Effect, Schema } from "effect";
import type { AgentEvent, Task } from "@reactive-agents/core";
import { AgentId, EventBus, generateTaskId } from "@reactive-agents/core";
import type { TestTurn } from "@reactive-agents/llm-provider";
import { ReactiveAgents } from "../../src/index.js";
import { buildLightRuntimeConfig, createLightRuntime } from "../../src/runtime.js";
import { ExecutionEngine } from "../../src/execution-engine.js";
import { subAgentMaxCallsPerTool } from "../../src/builder/build-effect/local-agent-tools.js";

// The trigger sits past char 200 so the truncated "Parent task:" prefix the
// child inherits never contains it (mirrors ledger-merge.test.ts). The child is
// matched by its persona role, which is in every one of its system prompts.
const filler = "prime the delegation run with a long preamble. ".repeat(6);
const parentTask = `${filler} PARENT_GO: delegate the two reads.`;

/**
 * Two distinct `file-read` calls, then a final answer. The files must exist:
 * the kernel charges the cap with successful calls only, so a failed read
 * would never use it up.
 */
const childTurns = (match?: string): TestTurn[] => [
  { ...(match ? { match } : {}), toolCall: { name: "file-read", args: { path: "package.json" } } },
  { ...(match ? { match } : {}), toolCall: { name: "file-read", args: { path: "VERSION" } } },
  { ...(match ? { match } : {}), text: "FINAL ANSWER: child done" },
];

/** Parent spawns one child; the child makes two `file-read` calls. Returns how many ran. */
const runSpawn = async (maxCallsPerTool?: Readonly<Record<string, number>>): Promise<number> => {
  const parent = await ReactiveAgents.create()
    .withName("cap-parent")
    .withProvider("test")
    .withModel("test-model")
    .withDynamicSubAgents({ maxIterations: 6 })
    .withTools(maxCallsPerTool ? { maxCallsPerTool } : {})
    .withTestScenario([
      {
        match: "PARENT_GO",
        toolCall: {
          name: "spawn-agent",
          args: { task: "read both files", name: "capper", role: "CAPCHILD reader", tools: ["file-read"] },
        },
      },
      ...childTurns("CAPCHILD"),
      { text: "FINAL ANSWER: Done." },
    ])
    .build();
  const started: string[] = [];
  await parent.subscribe((e: AgentEvent) => {
    if (e._tag === "ToolCallStarted" && e.toolName === "file-read") started.push(e.callId);
  });
  try {
    await parent.run(parentTask);
  } finally {
    await parent.dispose();
  }
  return started.length;
};

/** A light runtime (the sub-agent runtime) with the given caps; returns how many `file-read` calls ran. */
const runLight = async (maxCallsPerTool?: Readonly<Record<string, number>>): Promise<number> => {
  const runtime = createLightRuntime({
    agentId: "cap-light",
    provider: "test",
    maxIterations: 6,
    enableReasoning: true,
    enableTools: true,
    allowedTools: ["file-read"],
    testScenario: childTurns(),
    ...(maxCallsPerTool ? { maxCallsPerTool } : {}),
  });
  const task: Task = {
    id: generateTaskId(),
    agentId: Schema.decodeSync(AgentId)("cap-light"),
    type: "query",
    input: { question: "Read package.json and VERSION." },
    priority: "medium",
    status: "pending",
    metadata: { tags: [] },
    createdAt: new Date(),
  };
  const started: string[] = [];
  await Effect.runPromise(
    Effect.gen(function* () {
      const bus = yield* EventBus;
      yield* bus.on("ToolCallStarted", (e) =>
        Effect.sync(() => {
          if (e.toolName === "file-read") started.push(e.callId);
        }),
      );
      const engine = yield* ExecutionEngine;
      yield* Effect.either(engine.execute(task));
    }).pipe(Effect.provide(runtime)),
  );
  return started.length;
};

describe("maxCallsPerTool reaches sub-agents", () => {
  it("spawn-agent: the child inherits the parent's cap (second call refused)", async () => {
    expect(await runSpawn({ "file-read": 1 })).toBe(1);
  }, 30_000);

  it("spawn-agent control: without a parent cap both child calls run", async () => {
    expect(await runSpawn()).toBe(2);
  }, 30_000);

  it("light runtime enforces its own caps: {file-read:1} runs one, {file-read:2} runs two", async () => {
    expect(await runLight({ "file-read": 1 })).toBe(1);
    expect(await runLight({ "file-read": 2 })).toBe(2);
  }, 30_000);

  it("withAgentTool: the sub-agent's own caps merge over the parent's (own wins per name)", () => {
    expect(subAgentMaxCallsPerTool({ lookup: 1, search: 3 }, undefined)).toEqual({ lookup: 1, search: 3 });
    expect(subAgentMaxCallsPerTool({ lookup: 1, search: 3 }, { lookup: 2 })).toEqual({ lookup: 2, search: 3 });
    expect(subAgentMaxCallsPerTool(undefined, { lookup: 2 })).toEqual({ lookup: 2 });
    expect(subAgentMaxCallsPerTool(undefined, undefined)).toBeUndefined();
  });

  it("withAgentTool wiring: parent caps reach the registration and the merge feeds the child runtime", () => {
    // A `.withAgentTool` child has no scripted scenario (it does not inherit the
    // parent's), so the path is pinned at the source like child-discover-tools.
    const reg = readFileSync("packages/runtime/src/builder/build-effect/tool-mcp-registrations.ts", "utf8");
    expect(reg.match(/parentMaxCallsPerTool: deps\.toolsOptions\.maxCallsPerTool/g)?.length).toBe(2);
    const local = readFileSync("packages/runtime/src/builder/build-effect/local-agent-tools.ts", "utf8");
    expect(local).toContain("subAgentMaxCallsPerTool(parentMaxCallsPerTool, agentCfg.maxCallsPerTool)");
    expect(local).toMatch(/maxCallsPerTool !== undefined \? \{ maxCallsPerTool \} : \{\}/);
  });

  it("buildLightRuntimeConfig carries the caps into the child config, and omits them when unset", () => {
    const base = { agentId: "c", provider: "test" as const };
    expect(buildLightRuntimeConfig({ ...base, maxCallsPerTool: { lookup: 1 } }).maxCallsPerTool).toEqual({ lookup: 1 });
    expect(buildLightRuntimeConfig(base).maxCallsPerTool).toBeUndefined();
  });

  it("withAgentTool rejects a cap that is not a positive integer", () => {
    let tag: unknown;
    try {
      ReactiveAgents.create().withAgentTool("helper", { name: "helper", maxCallsPerTool: { lookup: 0 } });
    } catch (e) {
      tag = (e as { _tag?: unknown })._tag;
    }
    expect(tag).toBe("ToolsOptionError");
  });
});
