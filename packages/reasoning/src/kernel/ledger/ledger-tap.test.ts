// Run: bun test packages/reasoning/src/kernel/ledger/ledger-tap.test.ts --timeout 15000
//
// Wave C.1 slice 3 — the runner surfaces every ledger append batch through
// `hooks.onLedgerAppend`, at the iteration boundary, exactly once per entry
// (no double-publish across iterations), in ledger `seq` order.
// `buildKernelHooks` bridges each batch to the EventBus as a typed
// `LedgerEntryAppended` core event (see `packages/core/src/services/event-bus.ts`).
//
// Why this test subscribes to a REAL EventBus instead of overriding
// `hooks.onLedgerAppend` directly: `runKernel` builds `hooks` internally via
// `buildKernelHooks(eventBus)` and never exposes that object to callers — the
// runner's own calls (`hooks.onDone`, `hooks.onError`, and this task's
// `hooks.onLedgerAppend`) always use the internally-built hooks, never
// `KernelContext.hooks` (which a wrapped ThoughtKernel COULD intercept, but
// that only reaches kernel-internal calls like `onThought`/`onAction`). See
// `packages/reasoning/tests/shared/kernel-runner-progress.test.ts`'s "Note on
// hook injection" for the same constraint pinned against `onIterationProgress`.
// Approach (a) from that note — subscribe to a real EventBus — is therefore
// the only way to observe this hook end to end.

import { describe, expect, it } from "bun:test";
import { Effect, Layer, Ref } from "effect";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { EventBus, EventBusLive } from "@reactive-agents/core";
import { mockToolServiceLayer } from "../../testing/tool-service-mock.js";
import { reactKernel } from "../loop/react-kernel.js";
import { runPass } from "../loop/run-pass.js";
import type { KernelInput, KernelRunOptions } from "../state/kernel-state.js";

// Same tool + scenario shape as `requirement-lifecycle.test.ts` (co-located in
// this ledger/ directory) — a single required-tool call, then a final answer.
const toolLayer = mockToolServiceLayer({
  execute: (req: { toolName: string; args?: unknown }) =>
    Effect.succeed({ success: true, result: { finding: `KEY FACT from ${req.toolName}` } }),
  getTool: (name: string) =>
    Effect.succeed({ name, description: "test", parameters: [{ name: "q", type: "string", required: true }] }),
});

const SCHEMAS = [
  { name: "alpha", description: "gather a", parameters: [{ name: "q", type: "string", required: true }] },
];

const scenario = () =>
  TestLLMServiceLayer([
    { toolCall: { name: "alpha", args: { q: "go" } } },
    { text: "Done — the answer is 42." },
  ]);

// Deliberately NOT the kernel-hooks.ts fallback ("reasoning-agent") — a run
// whose published agentId equals this value proves `buildKernelHooks` used
// the REAL `KernelInput.agentId` threaded through `runner.ts`'s
// `effectiveInput.agentId`, not the hardcoded placeholder.
const TEST_AGENT_ID = "ledger-tap-live-agent";

const run = (opts: Partial<KernelRunOptions> = {}) =>
  Effect.gen(function* () {
    const sink = yield* Ref.make<readonly Record<string, unknown>[]>([]);
    // Batch sizes in firing order — pins the LIVE (per-iteration) nature of
    // the tap, not just the aggregate "exactly once, in order" outcome. A
    // regression that keeps only the post-loop firing (dropping the in-loop
    // one) would still satisfy exactly-once-in-order on the flattened stream,
    // but would collapse every batch into a single end-of-run dump —
    // `batchSizes.length` catches that.
    const batchSizes: number[] = [];
    // agentId observed on each published event — pins that `buildKernelHooks`
    // threads the caller's real `KernelInput.agentId` end to end instead of
    // publishing the module-level placeholder on every run.
    const agentIds: string[] = [];
    const bus = yield* EventBus;
    yield* bus.on("LedgerEntryAppended", (ev) =>
      Ref.update(sink, (xs) => {
        batchSizes.push(ev.entries.length);
        agentIds.push(ev.agentId);
        return [...xs, ...ev.entries];
      }),
    );
    const pass = yield* runPass(
      reactKernel,
      {
        task: "Answer the question using the alpha tool.",
        availableToolSchemas: SCHEMAS,
        requiredTools: ["alpha"],
        agentId: TEST_AGENT_ID,
      } as KernelInput,
      {
        maxIterations: 6,
        strategy: "reactive",
        kernelType: "react",
        taskId: "ledger-tap-test",
        modelId: "llama3.2:3b",
        ...opts,
      },
    );
    const seen = yield* Ref.get(sink);
    return { pass, seen, batchSizes, agentIds };
  }).pipe(Effect.provide(Layer.mergeAll(scenario(), toolLayer, EventBusLive)));

describe("Wave C.1 slice 3 — onLedgerAppend live tap", () => {
  it("publishes every ledger entry exactly once, in seq order, across multiple iteration-boundary firings", async () => {
    const { pass, seen, batchSizes, agentIds } = await Effect.runPromise(run());

    // Sanity: this scenario actually grows the ledger (declared requirement +
    // tool-invocation/tool-result/requirement-satisfied entries) — otherwise
    // the exactly-once assertions below would pass vacuously on an empty run.
    const ledgerLen = pass.state.ledger?.length ?? 0;
    expect(ledgerLen).toBeGreaterThan(0);

    // Exactly once per entry — total published count matches the final ledger.
    expect(seen.length).toBe(ledgerLen);
    // Seq order preserved — the published stream, concatenated in firing
    // order, equals the ledger itself. (Cast: LedgerEntry has no index
    // signature, so it isn't statically assignable to the event's
    // Record<string, unknown> shape — runtime equality is unaffected.)
    expect(seen).toEqual((pass.state.ledger ?? []) as unknown as readonly Record<string, unknown>[]);
    // LIVE tap — this 2-turn (tool call + final answer) scenario spans at
    // least 2 iterations, so a genuinely per-iteration-boundary tap fires
    // more than once. A single firing would mean the mechanism only dumps
    // the ledger at run end, not live during the run.
    expect(batchSizes.length).toBeGreaterThan(1);
    // Real agentId threading — every published event carries the caller's
    // KernelInput.agentId (`TEST_AGENT_ID`), not `buildKernelHooks`'s
    // hardcoded fallback ("reasoning-agent"). Catches a regression that drops
    // the `effectiveInput.agentId` argument at the `runner.ts` call site.
    expect(agentIds.length).toBeGreaterThan(0);
    expect(agentIds.every((id) => id === TEST_AGENT_ID)).toBe(true);
  });
});
