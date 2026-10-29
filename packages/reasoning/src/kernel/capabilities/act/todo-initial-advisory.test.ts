// Run: bun test packages/reasoning/src/kernel/capabilities/act/todo-initial-advisory.test.ts --timeout 15000
//
// Conversation-level todo list: `KernelInput.initialAdvisory` seeds the run's
// ledger with `checklist-item` facts (published as ONE `restored` batch), so the
// list a prior turn left behind is live from iteration 0. Absent/empty is
// byte-identical to HEAD.
import { describe, expect, it } from "bun:test";
import { Effect, Layer } from "effect";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { EventBus, EventBusLive, foldAdvisory, makeChecklistTracker, nextAdvisoryIds } from "@reactive-agents/core";
import { mockToolServiceLayer } from "../../../testing/tool-service-mock.js";
import { reactKernel } from "../../loop/react-kernel.js";
import { runPass } from "../../loop/run-pass.js";
import { RunEnvelope, buildRunEnvelope, mergeRunEnvelopeIntoKernelInput } from "../../envelope/run-envelope.js";
import type { KernelInput, KernelRunOptions, KernelState } from "../../state/kernel-state.js";
import type { AdvisorySeedItem } from "../../state/checklist-seed.js";
import type { LedgerEntry } from "../../ledger/run-ledger.js";

const SCHEMAS = [
  {
    name: "todo",
    description: "checklist",
    parameters: [
      { name: "action", type: "string", required: true },
      { name: "items", type: "array", required: false },
      { name: "id", type: "number", required: false },
    ],
  },
];
const toolLayer = mockToolServiceLayer({
  execute: () => Effect.succeed({ success: true, result: {} }),
  getTool: (name: string) =>
    Effect.succeed({ name, description: "test", parameters: [{ name: "q", type: "string", required: true }] }),
});

const SEED: readonly AdvisorySeedItem[] = [
  { id: "1", title: "gather sources", status: "completed" },
  { id: "2", title: "draft summary", status: "in_progress" },
  { id: "5", title: "publish", status: "pending" },
];

const pad = (n: number): string => Array.from({ length: 450 }, (_, i) => `s${n}x${i}`).join(" ");
const todo = (n: number, args: Record<string, unknown>) => ({ text: pad(n), toolCall: { name: "todo", args } });
const FINAL = { text: "Done — the answer is 42." };

const input = (overrides: Partial<KernelInput> = {}): KernelInput =>
  ({
    task: "Continue the work.",
    availableToolSchemas: SCHEMAS,
    metaTools: { todo: true },
    contextProfile: { tier: "local" },
    ...overrides,
  }) as KernelInput;
const opts: KernelRunOptions = {
  maxIterations: 8,
  strategy: "reactive",
  kernelType: "react",
  taskId: "seed-test",
  modelId: "llama3.2:3b",
};

const run = (turns: Parameters<typeof TestLLMServiceLayer>[0], inp: KernelInput) =>
  Effect.runPromise(
    runPass(reactKernel, inp, opts).pipe(Effect.provide(Layer.mergeAll(TestLLMServiceLayer(turns), toolLayer, EventBusLive))),
  );

const facts = (ledger: readonly LedgerEntry[] | undefined) =>
  (ledger ?? []).flatMap((e) => (e.kind === "checklist-item" ? [e] : []));
const todoObs = (s: KernelState): string[] =>
  s.steps.filter((x) => x.type === "observation" && x.metadata?.observationResult?.toolName === "todo").map((x) => x.content);

describe("KernelInput.initialAdvisory", () => {
  it("seeds ledger facts with original ids/statuses; one restored batch precedes every increment", async () => {
    const batches: { restored: boolean; entries: readonly unknown[] }[] = [];
    const tracker = makeChecklistTracker("seed-test");
    const snapshots: ReturnType<typeof tracker.track>[] = [];
    const pass = await Effect.runPromise(
      Effect.gen(function* () {
        const bus = yield* EventBus;
        yield* bus.on("LedgerEntryAppended", (ev) =>
          Effect.sync(() => {
            batches.push({ restored: ev.restored === true, entries: ev.entries });
            snapshots.push(tracker.track(ev as never));
          }),
        );
        return yield* runPass(reactKernel, input({ initialAdvisory: SEED }), opts);
      }).pipe(Effect.provide(Layer.mergeAll(TestLLMServiceLayer([FINAL]), toolLayer, EventBusLive))),
    );
    expect(foldAdvisory(facts(pass.state.ledger)).map((i) => [i.id, i.title, i.status])).toEqual([
      ["1", "gather sources", "completed"],
      ["2", "draft summary", "in_progress"],
      ["5", "publish", "pending"],
    ]);
    expect(batches[0]?.restored).toBe(true);
    expect(batches.filter((b) => b.restored).length).toBe(1);
    // First projection already shows the seeded list (iteration 0).
    const first = snapshots.find((s) => s !== undefined);
    expect(first?.root.rows.map((r) => [r.id, r.status])).toEqual([
      ["1", "done"],
      ["2", "in_progress"],
      ["5", "pending"],
    ]);
  });

  it("model `todo done <seeded id>` works; completed seeded items stay completed; list renders canonically", async () => {
    const pass = await run([todo(1, { action: "list" }), todo(2, { action: "done", id: 2 }), FINAL], input({ initialAdvisory: SEED }));
    const obs = todoObs(pass.state);
    expect(obs[0]).toContain("[x] 1. gather sources");
    expect(obs[0]).toContain("[~] 2. draft summary");
    expect(obs[0]).toContain("[ ] 5. publish");
    expect(obs[1]).toContain("[x] 2. draft summary");
    expect(obs[1]).toContain("[x] 1. gather sources");
  });

  it("a later `add` continues numbering after the max seeded id", async () => {
    const pass = await run([todo(3, { action: "add", items: ["review"] }), FINAL], input({ initialAdvisory: SEED }));
    const items = foldAdvisory(facts(pass.state.ledger));
    expect(items.at(-1)).toMatchObject({ id: "6", title: "review", status: "pending" });
    expect(nextAdvisoryIds(items, 1)).toEqual(["7"]);
  });

  it("absent or empty => ledger, messages and steps identical to HEAD (no seed facts)", async () => {
    const script = () => [{ text: pad(9), toolCall: { name: "todo", args: { action: "list" } } }, FINAL];
    const absent = await run(script(), input());
    const empty = await run(script(), input({ initialAdvisory: [] }));
    expect(facts(absent.state.ledger)).toEqual([]);
    expect(facts(empty.state.ledger)).toEqual([]);
    expect(empty.state.messages).toEqual(absent.state.messages);
    expect(empty.state.steps.map((s) => s.content)).toEqual(absent.state.steps.map((s) => s.content));
    expect(empty.state.ledger?.map((e) => e.kind)).toEqual(absent.state.ledger?.map((e) => e.kind));
  });

  it("RunEnvelope carries the seed; explicit KernelInput field wins; absent adds no key", () => {
    const env = buildRunEnvelope({ initialAdvisory: SEED });
    expect(mergeRunEnvelopeIntoKernelInput(input(), env).initialAdvisory).toEqual(SEED);
    const own = [{ id: "9", title: "own", status: "pending" as const }];
    expect(mergeRunEnvelopeIntoKernelInput(input({ initialAdvisory: own }), env).initialAdvisory).toEqual(own);
    expect("initialAdvisory" in mergeRunEnvelopeIntoKernelInput(input(), buildRunEnvelope())).toBe(false);
  });

  it("seed reaches the run through the RunEnvelope alone (no per-strategy threading)", async () => {
    const pass = await Effect.runPromise(
      runPass(reactKernel, input(), opts).pipe(
        Effect.provide(Layer.mergeAll(TestLLMServiceLayer([FINAL]), toolLayer, EventBusLive)),
        Effect.provideService(RunEnvelope, buildRunEnvelope({ initialAdvisory: SEED })),
      ),
    );
    expect(foldAdvisory(facts(pass.state.ledger)).length).toBe(3);
  });

  it("a resumed run is never re-seeded", async () => {
    const first = await run([FINAL], input({ initialAdvisory: SEED }));
    const resumed = await run([FINAL], input({ initialAdvisory: SEED, resumeState: { ...first.state, status: "thinking" } }));
    expect(facts(resumed.state.ledger).length).toBe(facts(first.state.ledger).length);
  });
});
