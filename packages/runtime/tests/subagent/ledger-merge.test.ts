// Run: bun test packages/runtime/tests/subagent/ledger-merge.test.ts --timeout 30000
//
// Wave C.2 — a sub-agent's work becomes queryable facts of its PARENT run.
//
// Before this, a delegated run left no trace in its parent beyond a summary
// string: the child's tool calls, artifacts and verdicts died at the boundary.
// Now the child's run-scoped ledger crosses back on the spawn observation and
// merges into the parent's ledger, stamped `sub-agent:<name>` — and a
// grandchild keeps its OWN stamp through the nesting (innermost-wins), so a
// two-level delegation is fully attributable rather than flattened to one.
//
// This is the end-to-end pin over the whole chain: sub-agent-executor stamps →
// SubAgentResult.childRunLedger → inline-act attaches it to the spawn
// observation → projectStepsToLedger merges it → engine forwards the run-scoped
// ledger onto TaskResult.metadata.runLedger.
//
// RED-ON-CUT: drop the `subAgentLedger` attach (or the runLedger projection)
// from inline-act.ts and the child/grandchild passes vanish from the parent
// ledger; drop the executor's `mergePassLedger` stamp and provenance is lost.
import { describe, expect, it } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ReactiveAgents } from "../../src/index.js";

// The trigger sits past char 200 so the truncated "Parent task:" prefix a child
// inherits never contains it — only the top-level parent's full task does
// (mirrors nesting-depth.test.ts).
const filler = "prime the delegation run with a long preamble. ".repeat(6);
const parentTask = `${filler} NEST_ROOT_TRIGGER: begin the nested delegation.`;

describe("sub-agent ledger merges into the parent run", () => {
  it("attributes a child's and a grandchild's ledger under their own names", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ra-ledger-merge-"));
    const agent = await ReactiveAgents.create()
      .withName("merge-parent")
      .withProvider("test")
      .withModel("test-model")
      .withDynamicSubAgents({ maxIterations: 2, maxRecursionDepth: 3 })
      .withTools()
      .withObservability({ tracing: { dir } })
      .withTestScenario([
        { match: "NEST_ROOT_TRIGGER", toolCall: { name: "spawn-agent", args: { task: "LEVELONE do the level-one work", name: "child-one" } } },
        { match: "LEVELONE", toolCall: { name: "spawn-agent", args: { task: "LEVELTWO do the leaf work", name: "child-two" } } },
        { match: "LEVELTWO", text: "leaf done" },
        { text: "Done." },
      ])
      .build();

    const result = await agent.run(parentTask, { taskId: "merge-run" });
    await agent.dispose();

    const md = result.metadata as { runLedger?: ReadonlyArray<{ kind: string; seq: number; toolName?: string; pass?: string }> };
    const ledger = md.runLedger ?? [];
    const passes = new Set(ledger.map((e) => e.pass));

    // CONTROL: the parent's OWN spawn call is in the ledger, unstamped — if this
    // is absent the parent never built a ledger and the probe proves nothing.
    expect(ledger.some((e) => e.kind === "tool-invocation" && e.toolName === "spawn-agent" && e.pass === undefined)).toBe(true);

    // The child's ledger merged under its name.
    expect(passes.has("sub-agent:child-one")).toBe(true);
    // The grandchild kept its OWN attribution through the nesting (innermost-wins).
    expect(passes.has("sub-agent:child-two")).toBe(true);

    // Dense, monotonic seq across every merged pass — no collisions.
    expect(ledger.map((e, i) => e.seq === i).every(Boolean)).toBe(true);
  }, 30_000);
});
