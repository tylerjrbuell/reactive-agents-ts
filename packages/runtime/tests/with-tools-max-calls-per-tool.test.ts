// Run: bun test packages/runtime/tests/with-tools-max-calls-per-tool.test.ts --timeout 20000
//
// `.withTools({ maxCallsPerTool })` — the builder producer of the kernel's
// per-tool call cap (KernelInput.maxCallsPerTool).
//
// The kernel has enforced the cap for a long time (run-wide, and inside one turn
// since 32b42bbd2) and answers every refused call with a tool_result
// (dce77b195). Its only producer was the automatic `minCalls + 2` budget, which
// af2515de0 removed, so no user could set a cap any more. Pin: a scripted model
// calls `lookup` three times with distinct args; with a cap of 2 the third call
// is refused (handler never runs, a tool-gate guard-fired says why); without a
// cap all three run.
import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ReactiveAgents } from "../src/builder.js";
import { invalidMaxCallsPerTool } from "../src/builder/withers/tools.js";
import { agentConfigFromJSON, agentConfigToBuilder, agentConfigToJSON } from "../src/agent-config.js";

const lookupTool = (seen: string[]) => ({
  definition: {
    name: "lookup",
    description: "Look up a topic",
    parameters: [{ name: "q", type: "string" as const, description: "topic", required: true }],
    riskLevel: "low" as const,
    timeoutMs: 5_000,
    requiresApproval: false,
    source: "function" as const,
  },
  handler: (a: Record<string, unknown>) =>
    Effect.sync(() => {
      seen.push(String(a.q));
      return `lookup ok: ${String(a.q)}`;
    }),
});

interface GuardEvent {
  readonly kind?: string;
  readonly guard?: string;
  readonly outcome?: string;
  readonly reason?: string;
}

/** Run three distinct `lookup` calls; return the args the handler saw and the tool-gate guard events. */
const runScenario = async (maxCallsPerTool?: Readonly<Record<string, number>>) => {
  const seen: string[] = [];
  const dir = await mkdtemp(join(tmpdir(), "ra-max-calls-"));
  try {
    const agent = await ReactiveAgents.create()
      .withName("max-calls-per-tool")
      .withTestScenario([
        { toolCall: { name: "lookup", args: { q: "alpha" } } },
        { toolCall: { name: "lookup", args: { q: "beta" } } },
        { toolCall: { name: "lookup", args: { q: "gamma" } } },
        { text: "FINAL ANSWER: looked up the topics" },
      ])
      .withTools({ tools: [lookupTool(seen)], ...(maxCallsPerTool ? { maxCallsPerTool } : {}) })
      .withReasoning({ defaultStrategy: "reactive" })
      .withObservability({ tracing: { dir } })
      .withMaxIterations(10)
      .build();
    try {
      await agent.run("Look up alpha, beta and gamma.");
    } finally {
      await agent.dispose();
    }
    const gate: GuardEvent[] = [];
    for (const f of (await readdir(dir)).filter((x) => x.endsWith(".jsonl"))) {
      for (const line of (await readFile(join(dir, f), "utf-8")).split("\n")) {
        if (!line.trim()) continue;
        const ev = JSON.parse(line) as GuardEvent;
        if (ev.kind === "guard-fired" && ev.guard === "tool-gate") gate.push(ev);
      }
    }
    return { seen, gate };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};

describe(".withTools({ maxCallsPerTool })", () => {
  it("refuses the call past the cap and answers it", async () => {
    const { seen, gate } = await runScenario({ lookup: 2 });
    expect(seen).toEqual(["alpha", "beta"]);
    expect(gate.length).toBe(1);
    expect(gate[0]?.outcome).toBe("block");
    expect(gate[0]?.reason?.startsWith("lookup was not run:")).toBe(true);
  }, 60000);

  it("control: without a cap all three calls run", async () => {
    const { seen, gate } = await runScenario();
    expect(seen).toEqual(["alpha", "beta", "gamma"]);
    expect(gate).toEqual([]);
  }, 60000);

  it("merges across calls and round-trips through the declarative config", async () => {
    const builder = ReactiveAgents.create()
      .withProvider("test")
      .withTools({ maxCallsPerTool: { lookup: 2, other: 5 } })
      .withTools({ maxCallsPerTool: { lookup: 3 } });
    const config = builder.toConfig();
    expect(config.tools?.maxCallsPerTool).toEqual({ lookup: 3, other: 5 });
    const back = agentConfigFromJSON(agentConfigToJSON(config));
    expect(back.tools?.maxCallsPerTool).toEqual({ lookup: 3, other: 5 });
    const rebuilt = await agentConfigToBuilder(back);
    expect(rebuilt.toConfig().tools?.maxCallsPerTool).toEqual({ lookup: 3, other: 5 });
  });

  it("rejects caps that are not positive integers", () => {
    expect(invalidMaxCallsPerTool({ a: 1, b: 0, c: 1.5, d: -2, e: 3 })).toEqual(["b", "c", "d"]);
    expect(() => ReactiveAgents.create().withTools({ maxCallsPerTool: { lookup: 0 } })).toThrow(
      /maxCallsPerTool.*'lookup'/,
    );
    let tag: unknown;
    try {
      ReactiveAgents.create().withTools({ maxCallsPerTool: { lookup: 1.5 } });
    } catch (e) {
      tag = (e as { _tag?: unknown })._tag;
    }
    expect(tag).toBe("ToolsOptionError");
  });
});
