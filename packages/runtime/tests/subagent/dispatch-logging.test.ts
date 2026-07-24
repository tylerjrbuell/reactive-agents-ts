// Run: bun test packages/runtime/tests/subagent/dispatch-logging.test.ts --timeout 30000
//
// Sub-agent TUI logging (2026-07-23) — end-to-end capture. Proves the two
// readability fixes reach real console output when a parent delegates:
//   1. Dispatch delimiters frame the child's block ("▶ delegate → name" /
//      "◀ name ✓/✗ …"), emitted via the PARENT's logger.
//   2. The child's own lines carry the name-tagged prefix.
// Captures console.log for the run (live observability), then restores it.
import { describe, expect, it, afterEach } from "bun:test";
import { ReactiveAgents } from "../../src/index.js";

const realLog = console.log;
afterEach(() => {
  console.log = realLog;
});

describe("sub-agent dispatch logging", () => {
  it("frames the child's block with delimiters and attributes the child's lines", async () => {
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

    // The open + close delimiters framing the child's block.
    expect(all).toContain("▶ delegate → researcher");
    expect(all).toMatch(/◀ researcher [✓✗]/);
  }, 30_000);
});
