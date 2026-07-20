// Run: bun test packages/runtime/tests/subagent/depth-correlation.test.ts --timeout 30000
//
// B8-T3b pin: a delegated sub-agent's trace events share the parent's rootRunId
// at depth 1, with a distinct runId — so "this run and everything it spawned" is
// a single JSONL filter (group by rootRunId). Before the RunContext spine was
// threaded onto AgentStarted/AgentCompleted, child trace events had no rootRunId
// or depth and were an unlinked island.
//
// Red-on-cut: drop the `runContext` field from the child's task metadata (in
// sub-agent-executor.ts) — the child's run-started/run-completed lose rootRunId
// and depth 1, and this test fails.
import { describe, expect, it } from "bun:test";
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ReactiveAgents } from "../../src/index.js";

interface TraceRow {
  readonly kind?: string;
  readonly runId?: string;
  readonly rootRunId?: string;
  readonly parentRunId?: string;
  readonly depth?: number;
}

const loadAllTraceEvents = async (dir: string): Promise<TraceRow[]> => {
  const names = await readdir(dir);
  const rows: TraceRow[] = [];
  for (const name of names) {
    if (!name.endsWith(".jsonl")) continue;
    const text = await readFile(join(dir, name), "utf8");
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        rows.push(JSON.parse(trimmed) as TraceRow);
      } catch {
        // skip malformed line
      }
    }
  }
  return rows;
};

describe("sub-agent trace depth correlation (B8-T3b)", () => {
  it("child trace events share the parent's rootRunId at depth 1", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ra-t3b-"));
    const parentRunId = "t3b-parent-run";

    const agent = await ReactiveAgents.create()
      .withName("t3b-parent")
      .withProvider("test")
      .withModel("test-model")
      .withDynamicSubAgents({ maxIterations: 2 })
      .withTools()
      .withObservability({ tracing: { dir } })
      .withTestScenario([
        {
          match: "DELEGATE_ROOT",
          toolCall: {
            name: "spawn-agent",
            args: { task: "child research subtask", name: "researcher" },
          },
        },
        { text: "Done." },
      ])
      .build();

    await agent.run("DELEGATE_ROOT: delegate a research subtask.", {
      taskId: parentRunId,
    });
    // dispose flushes any buffered trace events to disk.
    await agent.dispose();

    const events = await loadAllTraceEvents(dir);

    // Parent's own run-started must be a root: rootRunId === its runId, depth 0.
    const parentStarted = events.find(
      (e) => e.kind === "run-started" && e.runId === parentRunId,
    );
    expect(parentStarted).toBeDefined();
    expect(parentStarted!.rootRunId).toBe(parentRunId);
    expect(parentStarted!.depth ?? 0).toBe(0);

    // Child events: depth 1, rootRunId === parent runId, distinct runId.
    const childEvents = events.filter((e) => e.depth === 1);
    expect(childEvents.length).toBeGreaterThan(0);
    for (const e of childEvents) {
      expect(e.rootRunId).toBe(parentRunId);
      expect(e.runId).not.toBe(parentRunId);
      expect(e.parentRunId).toBe(parentRunId);
    }
  }, 30000);
});
