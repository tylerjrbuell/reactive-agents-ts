// Run: bun test packages/reasoning/tests/kernel/loop/pass-seed.test.ts --timeout 15000
//
// Plan 9 live H3 finding: reflexion's later kernel passes compiled a FRESH run
// contract from the harness improve-prompt and assessed only their own ledger,
// so `tool:file-write` — satisfied in pass 1 — never cleared. `KernelInput`'s
// `seedRunContract` + `seedRunLedger` (kernel/state/pass-seed.ts) let a later
// pass adopt the first pass's contract and continue its ledger. These tests
// drive the real `runKernel` setup twice and read the pass-2 assessment.
import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { runKernel } from "../../../src/kernel/loop/runner.js";
import { makeStep } from "../../../src/kernel/capabilities/sense/step-utils.js";
import { transitionState, type KernelInput, type KernelState, type ThoughtKernel } from "../../../src/kernel/state/kernel-state.js";

const FILE_WRITE_OBS = {
  success: true,
  toolName: "file-write",
  displayText: "Written to ./report.md",
  category: "file-write",
  resultKind: "side-effect",
  preserveOnCompaction: false,
} as const;

/** Pass 1: writes the file (action + observation), then finishes. */
const writingKernel: ThoughtKernel = (state) =>
  Effect.succeed(
    transitionState(state, {
      steps: [
        ...state.steps,
        makeStep("action", "file-write(./report.md)", {
          toolCall: { id: "w1", name: "file-write", arguments: { path: "./report.md", content: "r" } },
          toolUsed: "file-write",
        }),
        makeStep("observation", "Written to ./report.md", { toolCallId: "w1", observationResult: FILE_WRITE_OBS }),
      ],
      status: "done",
      output: "done",
      iteration: state.iteration + 1,
    }),
  );

/** Later passes: no tool call, just finish. */
const idleKernel: ThoughtKernel = (state) =>
  Effect.succeed(transitionState(state, { status: "done", output: "improved", iteration: state.iteration + 1 }));

const run = (kernel: ThoughtKernel, input: KernelInput): Promise<KernelState> =>
  Effect.runPromise(
    runKernel(kernel, input, { maxIterations: 2, strategy: "reflexion", kernelType: "react" }).pipe(
      Effect.provide(TestLLMServiceLayer()),
    ),
  );

const PASS1 = { task: "Write the summary report.", requiredTools: ["file-write"] } satisfies KernelInput;
const PASS2_TASK = "Improve the previous answer. Then create-ticket for follow-up and save to .//tmp/out.md";

describe("kernel pass seed — contract + ledger carry across passes", () => {
  it("a second pass seeded with the run ledger reports tool:file-write satisfied", async () => {
    const first = await run(writingKernel, PASS1);
    const contract = first.meta.runContract;
    expect(contract?.requirements.map((r) => r.id)).toContain("tool:file-write");
    // Pass 1's assessment ran BEFORE its kernel step; the write lives in its ledger.
    expect(first.ledger?.some((e) => e.kind === "tool-result" && e.toolName === "file-write" && e.success)).toBe(true);

    const second = await run(idleKernel, {
      task: PASS2_TASK,
      requiredTools: ["file-write"],
      ...(contract ? { seedRunContract: contract } : {}),
      seedRunLedger: first.ledger ?? [],
    });

    // The first pass's contract is adopted verbatim (no improve-prompt phantoms).
    expect(second.meta.runContract).toBe(contract);
    // The ledger continues: the seed is the prefix, seq stays dense.
    const seedLen = (first.ledger ?? []).length;
    expect(second.ledger?.slice(0, seedLen)).toEqual(first.ledger ?? []);
    expect(second.ledger?.map((e) => e.seq)).toEqual(second.ledger?.map((_, i) => i));
    // Assessment judges the whole run.
    expect(second.meta.assessment?.requirements.satisfied).toContain("tool:file-write");
    expect(second.meta.assessment?.requirements.outstanding).not.toContain("tool:file-write");
  });

  it("control: an unseeded second pass compiles its own contract and starts an empty-run ledger", async () => {
    const first = await run(writingKernel, PASS1);
    const second = await run(idleKernel, { task: PASS2_TASK, requiredTools: ["file-write"] });
    expect(second.meta.runContract).not.toBe(first.meta.runContract);
    expect(second.meta.assessment?.requirements.outstanding).toContain("tool:file-write");
  });
});
