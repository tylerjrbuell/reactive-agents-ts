// Run: bun test packages/runtime/tests/subagent/dispatch-logging.test.ts --timeout 30000
//
// Sub-agent TUI logging (2026-07-23) — end-to-end capture. Originally proved
// a dedicated "▶ delegate → name" / "◀ name ✓/✗ …" delimiter pair (emitted
// via the PARENT's logger) framed the child's block in plain/verbose console
// output.
//
// Task 7 (observability unified run-tree, 2026-07-25) removed that delimiter
// pair from `sub-agent-executor.ts` — dispatch/completion framing is now the
// live status renderer's collapsed sub-agent line (TTY/status mode only; see
// `packages/observability/tests/status-renderer-subagent.test.ts`). Plain
// buffered/verbose console output (this test's mode, no TTY) has no
// delimiter replacement. This test now asserts the sub-agent's dispatch and
// completion remain attributable to its name via the still-present
// per-iteration action/observation lines, which the delimiter pair was
// always somewhat redundant with.
// Captures console.log for the run (live observability), then restores it.
import { describe, expect, it, afterEach } from "bun:test";
import { ReactiveAgents } from "../../src/index.js";

const realLog = console.log;
afterEach(() => {
  console.log = realLog;
});

describe("sub-agent dispatch logging", () => {
  it("attributes dispatch and completion to the named sub-agent (delimiter pair removed, Task 7)", async () => {
    const lines: string[] = [];
    console.log = (...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    };

    const parent = await ReactiveAgents.create()
      .withName("log-parent")
      .withProvider("test")
      .withModel("test-model")
      .withDynamicSubAgents({ maxIterations: 2 })
      .withTools()
      .withObservability({ live: true, verbosity: "verbose" })
      .withTestScenario([
        { toolCall: { name: "spawn-agent", args: { task: "research the subject thoroughly", name: "researcher" } } },
        { text: "Done." },
      ])
      .build();

    await parent.run("Delegate a research task.");
    await parent.dispose();

    console.log = realLog;
    const all = lines.join("\n");

    // No dedicated delimiter pair anymore (removed, Task 7) — but the
    // dispatch and completion lines still name the sub-agent explicitly.
    // Re-pinned to the actual current lines (2026-08-13, Move 1 merge
    // triage): dispatch is the tool-call line naming the delegating tool;
    // completion is the `[obs]` line, which names the sub-agent AND carries
    // the ✓/✗ together on one line (a tighter pairing than the two
    // separately-worded strings this test previously expected).
    expect(all).toContain("[tool:spawn-agent] iter");
    expect(all).toMatch(/✓ Sub-agent "researcher"/);
  }, 30_000);
});
