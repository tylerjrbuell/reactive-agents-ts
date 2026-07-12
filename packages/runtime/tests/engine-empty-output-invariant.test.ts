// Run: bun test packages/runtime/tests/engine-empty-output-invariant.test.ts --timeout 20000
//
// Engine-boundary output/success invariant (M7's engine mirror).
//
// Empirical origin (2026-07-11 probe fleet): p10's second run and a p5 rerun
// shipped `success:true` with EMPTY output on the inline path — the engine
// derived success from ctx.metadata.isComplete and never looked at the output
// or the deliverables. Deterministic repro: a tool-call turn followed by an
// empty final turn → success:true, outputLen:0, verdict tool-grounded.
//
// Invariant: success with empty output is only honest when every DECLARED
// deliverable verifiably landed — then the artifacts ARE the answer and a
// deterministic completion note (marked harness-authored) replaces the
// silence. Otherwise the empty "success" is a failure with a real cause.
import { describe, it, expect, afterAll } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { ReactiveAgents } from "../src/index.js";

afterAll(() => rmSync("qa-test-empty", { recursive: true, force: true }));

describe("engine empty-output invariant", () => {
  it("empty final turn + verified deliverable → success with a harness-authored completion note", async () => {
    rmSync("qa-test-empty", { recursive: true, force: true });
    const agent = await ReactiveAgents.create()
      .withTools({ builtins: ["file-write"], required: ["file-write"] })
      .withTestScenario([
        {
          toolCall: {
            id: "t1",
            name: "file-write",
            args: { path: "./qa-test-empty/x.txt", content: "hi" },
          },
        },
        { text: "" },
      ])
      .build();
    try {
      const r = await agent.run("Write hi to the file ./qa-test-empty/x.txt.");
      expect(existsSync("qa-test-empty/x.txt")).toBe(true);
      expect(r.success).toBe(true);
      // The silence is replaced by a deterministic note…
      expect(String(r.output ?? "").trim().length).toBeGreaterThan(0);
      expect(String(r.output)).toContain("./qa-test-empty/x.txt");
      // …and honestly labeled as harness-authored, not model prose.
      expect(
        (r.metadata as { harnessAuthoredOutput?: boolean }).harnessAuthoredOutput,
      ).toBe(true);
      expect(r.receipt?.deliverables).toEqual([
        { spec: "produce the file ./qa-test-empty/x.txt", produced: true },
      ]);
    } finally {
      await agent.dispose();
    }
  }, 20000);

  it("empty output with NO verified deliverable → success:false with a real cause", async () => {
    const agent = await ReactiveAgents.create()
      .withTestScenario([{ text: "" }])
      .build();
    try {
      const r = await agent.run("Summarize the plot of Hamlet in one sentence.");
      expect(r.success).toBe(false);
      expect(String((r as { error?: string }).error ?? "")).toContain("no output");
    } finally {
      await agent.dispose();
    }
  }, 20000);
});
