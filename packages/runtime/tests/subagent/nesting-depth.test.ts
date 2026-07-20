// Run: bun test packages/runtime/tests/subagent/nesting-depth.test.ts --timeout 30000
//
// B8-T5 pins (audit G7 — teams were flat because depth was a literal 0 and
// children never got spawn tools):
//   1. A sub-agent can itself delegate — reaching depth 2 — when nesting is
//      enabled via withDynamicSubAgents({ maxRecursionDepth }).
//   2. Delegation is refused past maxRecursionDepth: the deepest child gets no
//      spawn tools, so the run stops at the cap with no RangeError.
//
// Red-on-cut: in sub-agent-executor.ts, force `registerChildSpawn = false` (or
// thread depth as a literal 0 instead of RunContext.depth) and pin 1 fails —
// the child has no spawn tools / the cap never advances, so depth 2 is never
// reached.
//
// Note on the scenario: sub-agents inherit the parent's test scenario, and the
// parent's task leaks into a child's system prompt as "Parent task: <first 200
// chars>". The parent's spawn-trigger marker (NEST_ROOT_TRIGGER) is placed PAST
// that 200-char boundary so children never re-match the parent's spawn turn —
// each level is selected purely by its own task marker.
import { describe, expect, it } from "bun:test";
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ReactiveAgents } from "../../src/index.js";

const loadDepths = async (dir: string): Promise<number[]> => {
  const names = await readdir(dir);
  const depths: number[] = [];
  for (const name of names) {
    if (!name.endsWith(".jsonl")) continue;
    const text = await readFile(join(dir, name), "utf8");
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const row = JSON.parse(trimmed) as { depth?: number };
        if (typeof row.depth === "number") depths.push(row.depth);
      } catch {
        /* skip */
      }
    }
  }
  return depths;
};

// The trigger sits past char 200 so the truncated "Parent task:" prefix a child
// inherits never contains it — only the top-level parent's full task does.
const filler = "prime the delegation run with a long preamble. ".repeat(6);
const parentTask = `${filler} NEST_ROOT_TRIGGER: begin the nested delegation.`;

describe("sub-agent nesting depth (B8-T5)", () => {
  it("a sub-agent sub-delegates to depth 2 when maxRecursionDepth allows", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ra-t5-nest-"));

    const agent = await ReactiveAgents.create()
      .withName("t5-nest-parent")
      .withProvider("test")
      .withModel("test-model")
      .withDynamicSubAgents({ maxIterations: 2, maxRecursionDepth: 3 })
      .withTools()
      .withObservability({ tracing: { dir } })
      .withTestScenario([
        {
          match: "NEST_ROOT_TRIGGER",
          toolCall: {
            name: "spawn-agent",
            args: { task: "LEVELONE do the level-one work", name: "child-one" },
          },
        },
        {
          match: "LEVELONE",
          toolCall: {
            name: "spawn-agent",
            args: { task: "LEVELTWO do the leaf work", name: "child-two" },
          },
        },
        { match: "LEVELTWO", text: "leaf done" },
        { text: "Done." },
      ])
      .build();

    await agent.run(parentTask, { taskId: "t5-nest-run" });
    await agent.dispose();

    const depths = await loadDepths(dir);
    expect(Math.max(...depths)).toBe(2);
  }, 30000);

  it("delegation is refused past maxRecursionDepth (stays at the cap, no crash)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ra-t5-cap-"));

    const agent = await ReactiveAgents.create()
      .withName("t5-cap-parent")
      .withProvider("test")
      .withModel("test-model")
      .withDynamicSubAgents({ maxIterations: 2, maxRecursionDepth: 1 })
      .withTools()
      .withObservability({ tracing: { dir } })
      .withTestScenario([
        {
          match: "NEST_ROOT_TRIGGER",
          toolCall: {
            name: "spawn-agent",
            args: { task: "LEVELONE do the level-one work", name: "child-one" },
          },
        },
        // child-one (depth 1, cap 1) has NO spawn tools — this spawn call finds
        // no tool and is handled as an observation, never a crash.
        {
          match: "LEVELONE",
          toolCall: {
            name: "spawn-agent",
            args: { task: "LEVELTWO do the leaf work", name: "child-two" },
          },
        },
        { text: "Done." },
      ])
      .build();

    const result = await agent.run(parentTask, { taskId: "t5-cap-run" });
    await agent.dispose();

    const depths = await loadDepths(dir);
    // A directly-delegated child reaches depth 1; nothing goes deeper.
    expect(Math.max(...depths)).toBe(1);
    expect(String(result.output ?? "")).not.toContain("RangeError");
  }, 30000);
});
