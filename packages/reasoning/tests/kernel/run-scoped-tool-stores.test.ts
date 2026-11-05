// Run: bun test packages/reasoning/tests/kernel/run-scoped-tool-stores.test.ts --timeout 20000
//
// Run-scoped meta-tool stores (the tools `runToolStoresSlot`, Plan 9 1R). The
// kernel reads the `recall` scratchpad through `currentScratchpadStore`, so two
// kernel runs, each opened with `withRunScope`, get separate scratchpads (the
// slot's `reset` policy mints a fresh bundle per run): both mint
// `_tool_result_1` for their first stored tool result, and neither can recall
// the other's entries. Before the migration the kernel read a process-global
// scratchpad, so keys accumulated across runs (`_tool_result_3` for the second
// run here) and recall leaked across runs/agents.
import { describe, expect, it } from "bun:test";
import { Effect, Layer, Ref } from "effect";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { EventBusLive, rootContext } from "@reactive-agents/core";
import { withRunScope } from "@reactive-agents/core/internal/run-scope";
import { currentScratchpadStore, makeRecallHandler } from "@reactive-agents/tools";
import { mockToolServiceLayer } from "../../src/testing/tool-service-mock.js";
import { reactKernel } from "../../src/kernel/loop/react-kernel.js";
import { runPass } from "../../src/kernel/loop/run-pass.js";
import type { KernelInput, KernelRunOptions } from "../../src/kernel/state/kernel-state.js";

const SCHEMAS = [
  {
    name: "fetch",
    description: "fetch a large document",
    parameters: [{ name: "q", type: "string", required: true }],
  },
];

// Large enough to overflow the inline cap, so act stores it under `_tool_result_N`.
const bigResult = (tag: string): string =>
  Array.from({ length: 400 }, (_, i) => `${tag} line ${i}: payload-${tag}-${i}`).join("\n");

const toolLayer = mockToolServiceLayer({
  execute: (req: { toolName: string; arguments?: Record<string, unknown> }) =>
    Effect.sync(() => ({
      success: true,
      result: bigResult(String(req.arguments?.q ?? "none")),
    })),
  getTool: (name: string) =>
    Effect.succeed({ name, description: "test", parameters: [{ name: "q", type: "string", required: true }] }),
});

let padN = 0;
const pad = (): string => {
  padN += 1;
  return Array.from({ length: 450 }, (_, i) => `w${padN}x${i}`).join(" ");
};
const fetchTurn = (q: string) => ({ text: pad(), toolCall: { name: "fetch", args: { q } } });
const FINAL = { text: "Done — the answer is 42." };

const input: KernelInput = {
  task: "Fetch the documents and summarize.",
  availableToolSchemas: SCHEMAS,
  metaTools: { recall: true },
  contextProfile: { tier: "local" },
} as KernelInput;

const opts = (taskId: string): KernelRunOptions => ({
  maxIterations: 6,
  strategy: "reactive",
  kernelType: "react",
  taskId,
  modelId: "llama3.2:3b",
});

type RunSnapshot = {
  readonly keys: readonly string[];
  readonly store: ReadonlyMap<string, string>;
  readonly recallFirst: unknown;
  readonly recallSecond: unknown;
};

/** One kernel run plus post-run reads of the SAME run's scratchpad / recall. */
const runOnce = (
  turns: Parameters<typeof TestLLMServiceLayer>[0],
  taskId: string,
  wrap: <A, E, R>(eff: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>,
): Promise<RunSnapshot> =>
  Effect.runPromise(
    wrap(
      Effect.gen(function* () {
        yield* runPass(reactKernel, input, opts(taskId));
        const store = new Map(yield* Ref.get(yield* currentScratchpadStore));
        const recall = makeRecallHandler();
        const recallFirst = yield* recall({ key: "_tool_result_1", full: true });
        const recallSecond = yield* recall({ key: "_tool_result_2", full: true });
        const keys = [...store.keys()].filter((k) => k.startsWith("_tool_result_")).sort();
        return { keys, store, recallFirst, recallSecond };
      }),
    ).pipe(Effect.provide(Layer.mergeAll(TestLLMServiceLayer(turns), toolLayer, EventBusLive))),
  );

const contentOf = (r: unknown): string =>
  typeof r === "object" && r !== null && "content" in r ? String((r as { content: unknown }).content) : "";
const notFound = (r: unknown): boolean =>
  typeof r === "object" && r !== null && "found" in r && (r as { found: unknown }).found === false;

describe("kernel run-scoped tool stores", () => {
  it("two wrapped runs mint the same first _tool_result key and cannot recall each other's entries", async () => {
    const a = await runOnce(
      [fetchTurn("alpha"), fetchTurn("alpha2"), FINAL],
      "run-a",
      withRunScope(rootContext("run-a", "agent-a")),
    );
    const b = await runOnce([fetchTurn("beta"), FINAL], "run-b", withRunScope(rootContext("run-b", "agent-b")));

    // Run A stored two results; run B stored one — and restarted at _1.
    expect(a.keys).toEqual(["_tool_result_1", "_tool_result_2"]);
    expect(b.keys).toEqual(["_tool_result_1"]);

    // Each run's recall resolves its OWN store.
    expect(contentOf(a.recallFirst)).toContain("payload-alpha-");
    expect(contentOf(b.recallFirst)).toContain("payload-beta-");
    expect(contentOf(b.recallFirst)).not.toContain("payload-alpha");

    // Run A's second entry is not reachable from run B.
    expect(contentOf(a.recallSecond)).toContain("payload-alpha2-");
    expect(notFound(b.recallSecond)).toBe(true);
    expect([...b.store.values()].some((v) => v.includes("payload-alpha"))).toBe(false);
  }, 20000);
});
