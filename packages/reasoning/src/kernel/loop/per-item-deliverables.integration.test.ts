// Run: bun test packages/reasoning/src/kernel/loop/per-item-deliverables.integration.test.ts
//
// Per-item deliverables — LIVE-LOOP pins (Plan 8 L7, 2026-11-03).
//
// A task that literally names three files compiles three `artifact-produced`
// requirements (source `task-explicit`), but the run-start PostCondition set the
// terminal gates read (`state.meta.postConditions`, single-path deriveConditions)
// held only the FIRST named file. A model that wrote 2 of 3 and claimed done was
// accepted. `deliveryConditions` (contract/declared-deliverables.ts) widens both
// gates — the arbitrator's exit-success spine and terminate.ts — with every
// per-item condition on the contract.
//
// RED-ON-CUT: make `deliveryConditions` return `meta.postConditions` unchanged
// and both tests below go red (the 2-of-3 claim is accepted as done).

import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { TestLLMServiceLayer, type TestTurn } from "@reactive-agents/llm-provider";
import { reactKernel } from "./react-kernel.js";
import { runPass } from "./run-pass.js";
import { succeedingToolLayer } from "../../testing/tool-service-mock.js";
import type { KernelInput } from "../state/kernel-state.js";
import { resolveCompletionStatus } from "../state/completion-status.js";

const PAD =
  " The petals rest quietly on the morning grass while the season slowly turns overhead.".repeat(30);

const FILE_WRITE_SCHEMA = {
  name: "file-write",
  description: "write content to a file",
  parameters: [
    { name: "path", type: "string", required: true },
    { name: "content", type: "string", required: true },
  ],
};

const TASK = "Write out-1.txt, out-2.txt and out-3.txt, each containing the word done.";

const write = (path: string, match?: string): TestTurn => ({
  ...(match !== undefined ? { match } : {}),
  toolCall: { name: "file-write", args: { path, content: "done" } },
});

const run = (scenario: TestTurn[], maxIterations: number) =>
  Effect.runPromise(
    runPass(reactKernel, { task: TASK, availableToolSchemas: [FILE_WRITE_SCHEMA] } satisfies KernelInput, {
      maxIterations,
      strategy: "reactive",
      kernelType: "react",
      taskId: "per-item-deliverables",
    }).pipe(
      Effect.provide(
        Layer.merge(
          TestLLMServiceLayer(scenario),
          succeedingToolLayer({ written: true }, FILE_WRITE_SCHEMA.parameters),
        ),
      ),
    ),
  );

const wrote = (steps: readonly { type: string; content: string }[], path: string): boolean =>
  steps.some((s) => s.type === "action" && s.content.includes(path));

describe("per-item deliverables — the terminal gate refuses partial work (live loop)", () => {
  it("writes 2 of 3 named files and claims done → refused naming ./out-3.txt → writes it → done", async () => {
    const pass = await run(
      [
        write("./out-1.txt"),
        write("./out-2.txt"),
        { text: "All three files are written; the task is complete." + PAD },
        // Reachable ONLY when the refusal's guidance names the missing item.
        write("./out-3.txt", "file \\./out-3\\.txt"),
        { text: "Now all three files exist on disk and the task is complete." + PAD },
      ],
      10,
    );
    expect(wrote(pass.state.steps, "out-3.txt")).toBe(true);
    expect(pass.state.status).toBe("done");
  });

  it("never writes the third file → the run never reports done; the outcome names ./out-3.txt", async () => {
    const pass = await run(
      [
        write("./out-1.txt"),
        write("./out-2.txt"),
        { text: "All three files are written; the task is complete." + PAD },
        { text: "Everything requested is on disk; nothing remains to be done." + PAD },
      ],
      5,
    );
    expect(wrote(pass.state.steps, "out-3.txt")).toBe(false);
    // Plan 8 item 3 (G1): the guard exit hands off instead of failing bare —
    // never "completed": an honest partial whose delivered output names the
    // missing ./out-3.txt (status "done" now carries a refused decision).
    expect(resolveCompletionStatus(pass.state)).toBe("partial");
    expect(pass.state.meta.deliverableDecision?.accepted).toBe(false);
    expect(pass.state.output ?? "").toContain("./out-3.txt");
    const named =
      (pass.state.error ?? "").includes("./out-3.txt") ||
      pass.state.steps.some((s) => s.content.includes("./out-3.txt"));
    expect(named).toBe(true);
  });
});
