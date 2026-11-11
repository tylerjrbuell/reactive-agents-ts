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
// deliverable verifiably landed — then the artifacts ARE the answer
// (receipt.deliverables). Otherwise the empty "success" is a failure with a
// real cause. Since 2026-11-10 the runtime writes no "Completed: ..." note and
// never refills output from a tool observation: the output is only the
// model's answer, so the first case ships output "" and its file rides
// receipt.deliverables.
import { describe, it, expect, afterAll } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { ReactiveAgents } from "../src/index.js";

afterAll(() => rmSync("qa-test-empty", { recursive: true, force: true }));

describe("engine empty-output invariant", () => {
  it("empty final turn + verified deliverable → success, output '', the file on receipt.deliverables", async () => {
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
      expect(r.outcome).toBe("success");
      // The model wrote nothing, so the output is empty: the tool's
      // observation ("Wrote x.txt ...") is not the model's answer and is
      // never copied into output (owner decision 2026-11-10).
      expect(r.output).toBe("");
      // The landed file IS the answer, and it is readable on the receipt.
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
      // GH #206 (2026-10-12): an exhausted run with no verified answer ends
      // with a deterministic honest abstention instead of silence. Owner
      // decision 2026-11-10: output stays "" and that cause rides `error`.
      // W4-live: the default-on zero-evidence stand-down now owns this terminal
      // earlier (<=2 iterations); both honest-abstention sentinels share this
      // prefix.
      expect(r.output).toBe("");
      expect(String(r.error ?? "")).toContain("Could not complete the task");
    } finally {
      await agent.dispose();
    }
  }, 20000);
});
