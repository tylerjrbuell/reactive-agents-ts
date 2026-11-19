// Run: bun test packages/reasoning/tests/kernel/act/batch-read-first.test.ts --timeout 15000
//
// Read-before-write in one round of native calls (cogito todo-heavy runs 0 and 5,
// live addendum 6 cause B): a round holding out-N's write and notes-N's read had the
// write authored without the value, so it carried placeholder content. Reordering
// cannot fix authored content, so the write is refused with a read-first hint; the
// read runs; the resubmitted write (no read in its round) passes.
// RED-ON-CUT: make `writeBeforeReadRefusal` return undefined.
import { describe, it, expect } from "bun:test";
import { Effect, Option } from "effect";
import { HarnessPipeline, RegistrationHarness } from "@reactive-agents/core";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { TextParseDriver, type ToolCallSpec } from "@reactive-agents/tools";
import { handleActing } from "../../../src/kernel/capabilities/act/act.js";
import { writeBeforeReadRefusal } from "../../../src/kernel/capabilities/act/batch-read-first.js";
import { initialKernelState, noopHooks, type KernelContext, type KernelInput, type KernelState, type ToolServiceInstance } from "../../../src/kernel/state/kernel-state.js";
import { makeKernelInput } from "../../../src/testing/kernel-fixtures.js";
import { CONTEXT_PROFILES } from "../../../src/context/context-profile.js";
import type { StepId } from "../../../src/types/step.js";

const TASK = `Six files in your working directory, notes-1.txt through notes-6.txt, each contain one integer. For each notes-N.txt, write out-N.txt containing exactly double that integer (digits only). Finish all six.`;

const read = (id: string, path: string): ToolCallSpec => ({ id, name: "file-read", arguments: { path } });
const write = (id: string, path: string, content = "?"): ToolCallSpec => ({ id, name: "file-write", arguments: { path, content } });
const inputOf: KernelInput = makeKernelInput({ task: TASK, requiredTools: [], requiredToolQuantities: {} });
const emptyState = (): KernelState =>
  initialKernelState({ maxIterations: 14, strategy: "react-kernel", kernelType: "react", taskId: "batch-read-first" });

describe("writeBeforeReadRefusal", () => {
  it("refuses out-2's write when notes-2 is read in the same round and not before", () => {
    const w = write("w", "out-2.txt");
    const text = writeBeforeReadRefusal(w, [read("r", "notes-2.txt"), w], emptyState(), inputOf);
    expect(text).toContain("out-2.txt depends on notes-2.txt");
    expect(text).toContain("write ./out-2.txt from it");
  });

  it("refuses the same write when it is listed before the read", () => {
    const w = write("w", "out-2.txt");
    expect(writeBeforeReadRefusal(w, [w, read("r", "notes-2.txt")], emptyState(), inputOf)).toContain("depends on notes-2.txt");
  });

  it("passes a write whose paired read is not in the round, an unpaired write, and a read", () => {
    const w = write("w", "out-2.txt");
    expect(writeBeforeReadRefusal(w, [w, read("r", "notes-3.txt")], emptyState(), inputOf)).toBeUndefined();
    const s = write("s", "summary.txt");
    expect(writeBeforeReadRefusal(s, [read("r", "notes-2.txt"), s], emptyState(), inputOf)).toBeUndefined();
    expect(writeBeforeReadRefusal(read("r", "notes-2.txt"), [read("r", "notes-2.txt")], emptyState(), inputOf)).toBeUndefined();
  });
});

// ── through the real act path ─────────────────────────────────────────────────

function recordingTools(ran: string[]): Option.Option<ToolServiceInstance> {
  return Option.some({
    execute: (req) => {
      ran.push(`${req.toolName}:${String((req.arguments as Record<string, unknown>).path).split("/").pop()}`); // the healer absolutizes paths
      return Effect.succeed({ success: true, result: "5" });
    },
    getTool: () => Effect.fail(new Error("no schema")),
    listTools: () => Effect.succeed([]),
  });
}

function context(ran: string[]): KernelContext {
  const profile = CONTEXT_PROFILES["mid"];
  return {
    input: {
      ...inputOf,
      availableToolSchemas: [
        { name: "file-read", description: "read", parameters: [] },
        { name: "file-write", description: "write", parameters: [] },
      ],
      harnessPipeline: new HarnessPipeline(new RegistrationHarness()._collected),
      nextMovesPlanning: { enabled: true, allowParallelBatching: true, maxBatchSize: 3 },
    } as KernelContext["input"],
    profile,
    compression: { budget: profile.toolResultMaxChars ?? 800, previewItems: 3, autoStore: true, codeTransform: true },
    toolService: recordingTools(ran),
    hooks: noopHooks,
    toolCallingDriver: new TextParseDriver(),
  };
}

function stateWith(pending: readonly ToolCallSpec[], steps: KernelState["steps"] = []): KernelState {
  const thought = { id: "t-1" as StepId, type: "thought" as const, content: "go", timestamp: new Date() };
  return {
    ...emptyState(),
    status: "acting",
    steps: [thought, ...steps],
    meta: { pendingNativeToolCalls: [...pending], lastThought: "go", lastThinking: null },
  };
}

const act = (state: KernelState, ran: string[]) =>
  Effect.runPromise(handleActing(state, context(ran)).pipe(Effect.provide(TestLLMServiceLayer())));

describe("a round with a write and the read of its input", () => {
  it("runs the read, refuses the write, then lets the resubmitted write run", async () => {
    const ran: string[] = [];
    const first = await act(stateWith([read("r1", "notes-2.txt"), write("w1", "out-2.txt", "placeholder")]), ran);
    expect(ran).toEqual(["file-read:notes-2.txt"]);
    const refusal = first.steps.find((s) => s.type === "observation" && s.metadata?.toolCallId === "w1");
    expect(refusal?.content).toContain("depends on notes-2.txt");

    const second = await act(stateWith([write("w2", "out-2.txt", "10")], first.steps), ran);
    expect(ran).toEqual(["file-read:notes-2.txt", "file-write:out-2.txt"]);
    expect(second.steps.some((s) => s.type === "observation" && s.metadata?.toolCallId === "w2" && !s.content.includes("depends on"))).toBe(true);
  });
});
