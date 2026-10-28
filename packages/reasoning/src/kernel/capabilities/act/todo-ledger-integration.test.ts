// Run: bun test packages/reasoning/src/kernel/capabilities/act/todo-ledger-integration.test.ts --timeout 15000
//
// `todo` writes `checklist-item` ledger facts (round-local staging, committed
// on every act exit) — the global `_todo:<taskId>` scratchpad list and the
// runner's reset are retired. Plan 2026-10-28-plan-and-goal-primitives, Task 4;
// Review Focus 2-4.
import { describe, expect, it } from "bun:test";
import { Effect, Layer, Ref } from "effect";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import {
  EventBus,
  EventBusLive,
  HarnessPipeline,
  RegistrationHarness,
  RunControllerRef,
  foldAdvisory,
  type RunControllerLike,
} from "@reactive-agents/core";
import { scratchpadStoreRef } from "@reactive-agents/tools";
import { mockToolServiceLayer } from "../../../testing/tool-service-mock.js";
import { reactKernel } from "../../loop/react-kernel.js";
import { runPass } from "../../loop/run-pass.js";
import { applyStrategySwitch } from "../../loop/runner-helpers/strategy-switch.js";
import {
  initialKernelState,
  noopHooks,
  transitionState,
  type KernelContext,
  type KernelHooks,
  type KernelInput,
  type KernelRunOptions,
  type KernelState,
} from "../../state/kernel-state.js";
import { deserializeKernelState } from "../../state/kernel-codec.js";
import { appendEntry, type LedgerEntry } from "../../ledger/run-ledger.js";

const SCHEMAS = [
  ...Array.from({ length: 12 }, (_, i) => ({
    name: `gather${i + 1}`,
    description: "gather",
    parameters: [{ name: "q", type: "string", required: true }],
  })),
  { name: "brief", description: "situational snapshot", parameters: [{ name: "section", type: "string", required: false }] },
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

const executed: string[] = [];
const toolLayer = mockToolServiceLayer({
  execute: (req: { toolName: string }) =>
    Effect.sync(() => {
      executed.push(req.toolName);
      return { success: true, result: { finding: `KEY FACT ${executed.length}-${Math.random().toString(36).slice(2)}` } };
    }),
  getTool: (name: string) =>
    Effect.succeed({ name, description: "test", parameters: [{ name: "q", type: "string", required: true }] }),
});

const FINAL = { text: "Done — the answer is 42." };
// The kernel's token-delta guard exits a run whose iterations each add <300 tokens (local tier)
// from iteration 3 on. Scripted turns carry a UNIQUE ~700-token thought so long
// scripts are not cut short (and the repeated-thought guard stays quiet).
let padN = 0;
const pad = (): string => {
  padN += 1;
  return Array.from({ length: 450 }, (_, i) => `w${padN}x${i}`).join(" ");
};
const todo = (args: Record<string, unknown>) => ({ text: pad(), toolCall: { name: "todo", args } });
const calls = (...cs: { name: string; args: Record<string, unknown> }[]) => ({ text: pad(), toolCalls: cs });
// The stall guard counts every think/act pass without a new tool artifact, so from
// iteration 2 on a meta-tool-only turn ends the run. `inter` pairs each scripted todo
// turn with a real (alpha) call in the SAME turn, which keeps the run progressing.
const inter = (...turns: ReturnType<typeof todo>[]) =>
  turns.map((t, i) => calls(t.toolCall, { name: `gather${i + 1}`, args: { q: `go-${++padN}` } }));

const input = (overrides: Partial<KernelInput> = {}): KernelInput =>
  ({
    task: "Plan and finish the work.",
    availableToolSchemas: SCHEMAS,
    metaTools: { todo: true },
    contextProfile: { tier: "local" },
    ...overrides,
  }) as KernelInput;

const opts = (overrides: Partial<KernelRunOptions> = {}): KernelRunOptions => ({
  maxIterations: 12,
  strategy: "reactive",
  kernelType: "react",
  taskId: "todo-ledger-test",
  modelId: "llama3.2:3b",
  ...overrides,
});

const runScenario = (
  turns: Parameters<typeof TestLLMServiceLayer>[0],
  inp: KernelInput = input(),
  o: KernelRunOptions = opts(),
) =>
  Effect.runPromise(
    runPass(reactKernel, inp, o).pipe(
      Effect.provide(Layer.mergeAll(TestLLMServiceLayer(turns), toolLayer, EventBusLive)),
    ),
  );

const checklistFacts = (ledger: readonly LedgerEntry[] | undefined) =>
  (ledger ?? []).flatMap((e) => (e.kind === "checklist-item" ? [e] : []));

const todoObservations = (state: KernelState): string[] =>
  state.steps
    .filter((s) => s.type === "observation" && s.metadata?.observationResult?.toolName === "todo")
    .map((s) => s.content);

describe("todo -> checklist-item ledger facts", () => {
  it("sequential turns: exactly the effective facts; no-ops and unknown ids mint nothing", async () => {
    const pass = await runScenario([
      ...inter(
        todo({ action: "add", items: ["a", "b"] }),
        todo({ action: "start", id: 1 }),
        todo({ action: "done", id: 1 }),
        todo({ action: "done", id: 1, note: "again" }),
        todo({ action: "done", id: 9 }),
      ),
      FINAL,
    ]);
    const facts = checklistFacts(pass.state.ledger);
    expect(facts.length).toBe(3);
    expect(foldAdvisory(facts).map((i) => [i.id, i.status])).toEqual([
      ["1", "completed"],
      ["2", "pending"],
    ]);
    // Facts stamped with the round's iteration (state.iteration + 1) and tool call id.
    expect(facts.map((f) => f.iteration)).toEqual([1, 2, 3]);
    expect(facts.every((f) => typeof f.toolCallId === "string")).toBe(true);
    // The no-op / unknown-id calls render exactly as before.
    const obs = todoObservations(pass.state)
    expect(obs[2]).toContain("[x] 1. a");
    expect(obs[3]).toContain("[x] 1. a");
    expect(obs[4]).toContain("No todo item with id 9.");
    // Nothing is written to the legacy scratchpad key.
    expect([...pass.state.scratchpad.keys()].some((k) => k.startsWith("_todo:"))).toBe(false);
  });

  it("one turn: add + start composes in order", async () => {
    const pass = await runScenario([
      calls({ name: "todo", args: { action: "add", items: ["a", "b"] } }, { name: "todo", args: { action: "start", id: 1 } }),
      FINAL,
    ]);
    expect(foldAdvisory(checklistFacts(pass.state.ledger)).map((i) => [i.id, i.status])).toEqual([
      ["1", "in_progress"],
      ["2", "pending"],
    ]);
    expect(checklistFacts(pass.state.ledger).length).toBe(2);
  });

  it("malformed calls render text and add no fact", async () => {
    const pass = await runScenario([
      ...inter(
        todo({ action: "add", items: ["a"] }),
        todo({ action: "done", id: "2" }),
        todo({ action: "done", id: "abc" }),
        todo({ action: "done" }),
        todo({ action: "add", items: [] }),
        todo({ action: "frobnicate" }),
      ),
      FINAL,
    ]);
    expect(checklistFacts(pass.state.ledger).length).toBe(1);
    const obs = todoObservations(pass.state)
    expect(obs[1]).toContain("No todo item with id 2.");
    expect(obs[2]).toContain("No todo item with id abc.");
    expect(obs[3]).toContain("No todo item with id undefined.");
    expect(obs[4]).toContain("No items provided.");
    expect(obs[5]).toContain('Unknown action "frobnicate".');
  });

  it("todo done + final-answer in one turn: the fact reaches the final ledger", async () => {
    const pass = await runScenario([
      todo({ action: "add", items: ["a", "b"] }),
      calls(
        { name: "todo", args: { action: "done", id: 2 } },
        { name: "final-answer", args: { output: "all done", format: "text", summary: "s", confidence: "high" } },
      ),
    ]);
    expect(pass.state.status).toBe("done");
    expect(foldAdvisory(checklistFacts(pass.state.ledger)).map((i) => [i.id, i.status])).toEqual([
      ["1", "pending"],
      ["2", "completed"],
    ]);
    expect(checklistFacts(pass.state.ledger).length).toBe(2);
  });

  // Every killswitch exit in act.ts commits the round's staged facts exactly once.
  for (const [when, phase] of [
    ["before", "act"],
    ["after", "act"],
    ["before", "observe"],
    ["after", "observe"],
  ] as const) {
    it(`killswitch abort at ${when}-${phase}: staged facts are committed once`, async () => {
      const reg = new RegistrationHarness();
      const abort = (ctx: { iteration: number }) =>
        ctx.iteration >= 0 ? ({ abort: "stop", reason: "test-killswitch" } as const) : undefined;
      if (when === "before") reg.before(phase, abort);
      else reg.after(phase, abort);
      const harnessPipeline = new HarnessPipeline(reg._collected as ConstructorParameters<typeof HarnessPipeline>[0]);
      const pass = await runScenario(
        [calls({ name: "todo", args: { action: "add", items: ["a", "b"] } }, { name: "todo", args: { action: "done", id: 1 } }), FINAL],
        input({ harnessPipeline }),
      );
      expect(pass.state.meta.terminatedBy).toBe("test-killswitch");
      const facts = checklistFacts(pass.state.ledger);
      expect(facts.length).toBe(2);
      expect(foldAdvisory(facts).map((i) => [i.id, i.status])).toEqual([
        ["1", "completed"],
        ["2", "pending"],
      ]);
    });
  }

  it("a strategy switch carries the list: todo list afterwards shows the prior items", async () => {
    const first = await runScenario([todo({ action: "add", items: ["a", "b"] }), FINAL]);
    const hooks: KernelHooks = { ...noopHooks };
    const options = { strategy: "reactive" } as KernelRunOptions;
    const inp = { task: "t", requiredTools: [] } as KernelInput;
    const context = { input: inp } as KernelContext;
    const r = await Effect.runPromise(
      applyStrategySwitch({
        state: first.state,
        currentInput: inp,
        context,
        options,
        hooks,
        triedStrategies: ["reactive"],
        switchCount: 0,
        fromStrategy: "reactive",
        toStrategy: "plan-execute-reflect",
        failureReason: "loop detected",
      }),
    );
    expect(foldAdvisory(checklistFacts(r.state.ledger)).map((i) => i.title)).toEqual(["a", "b"]);
    // and a continuing pass seeded with that state lists them
    const cont = await runScenario(
      [todo({ action: "list" }), FINAL],
      input({ resumeState: transitionState(r.state, { status: "thinking" }) }),
    );
    expect(todoObservations(cont.state)[0]).toContain("[ ] 1. a");
  });

  it("a continuation pass seeded with the prior ledger keeps the full list and does not duplicate", async () => {
    const first = await runScenario([todo({ action: "add", items: ["a"] }), todo({ action: "start", id: 1 }), FINAL]);
    const cont = await runScenario(
      [todo({ action: "done", id: 1 }), FINAL],
      input({ resumeState: transitionState(first.state, { status: "thinking" }) }),
    );
    const facts = checklistFacts(cont.state.ledger);
    expect(facts.length).toBe(3);
    expect(foldAdvisory(facts).map((i) => [i.id, i.status])).toEqual([["1", "completed"]]);
  });

  it("a fresh run after a prior run in the same process starts empty (no shared global list)", async () => {
    await runScenario([todo({ action: "add", items: ["leak?"] }), FINAL], input({ taskId: undefined }), opts({ taskId: undefined }));
    const second = await runScenario([todo({ action: "list" }), FINAL], input({ taskId: undefined }), opts({ taskId: undefined }));
    expect(todoObservations(second.state)[0]).toBe(
      "Todo list is empty. Call todo with action 'add' and items to plan your task.",
    );
  });

  it("mid-run checkpoint then resume: one restored batch before any increment; list intact; tools not re-run", async () => {
    // Run 1: capture the checkpoint taken after `start 1` was committed.
    const checkpoints: string[] = [];
    const ctl: RunControllerLike = {
      checkpoint: () => Promise.resolve(undefined),
      onCheckpoint: (s) => {
        checkpoints.push(s);
      },
    };
    executed.length = 0;
    await Effect.runPromise(
      runPass(reactKernel, input(), opts()).pipe(
        Effect.provide(
          Layer.mergeAll(
            TestLLMServiceLayer([
              ...inter(todo({ action: "add", items: ["a", "b"] }), todo({ action: "start", id: 1 })),
              FINAL,
            ]),
            toolLayer,
            EventBusLive,
          ),
        ),
        (eff) => Effect.locally(eff, RunControllerRef, ctl),
      ),
    );
    expect(executed.filter((n) => n.startsWith("gather")).length).toBe(2);
    // Latest checkpoint that already holds the `start 1` fact but is not terminal.
    const restoredState = checkpoints
      .map((c) => deserializeKernelState(c))
      .reverse()
      .find((s) => checklistFacts(s.ledger).length === 2 && s.status === "thinking");
    expect(restoredState).toBeDefined();

    // Run 2: resume.
    executed.length = 0;
    const batches: { restored: boolean; n: number }[] = [];
    const resumed = await Effect.runPromise(
      Effect.gen(function* () {
        const bus = yield* EventBus;
        yield* bus.on("LedgerEntryAppended", (ev) =>
          Effect.sync(() => {
            batches.push({ restored: ev.restored === true, n: ev.entries.length });
          }),
        );
        return yield* runPass(
          reactKernel,
          input({ resumeState: transitionState(restoredState as KernelState, { status: "thinking" }) }),
          opts(),
        );
      }).pipe(
        Effect.provide(
          Layer.mergeAll(TestLLMServiceLayer([todo({ action: "list" }), FINAL]), toolLayer, EventBusLive),
        ),
      ),
    );
    const restoredBatches = batches.filter((b) => b.restored);
    expect(restoredBatches.length).toBe(1);
    expect(batches[0]?.restored).toBe(true);
    expect(restoredBatches[0]?.n).toBe((restoredState as KernelState).ledger?.length ?? -1);
    expect(todoObservations(resumed.state).at(-1)).toContain("[~] 1. a");
    expect(executed.some((n) => n.startsWith("gather"))).toBe(false);
  });

  it("legacy checkpoint: _todo:t1 migrated once, every _todo:* key removed, repainted via restored+increment", async () => {
    const base = initialKernelState(opts({ taskId: "t1" }));
    const legacyState = transitionState(base, {
      status: "thinking",
      ledger: appendEntry(base.ledger, { kind: "harness-signal", iteration: 0, signal: "pre-crash" }),
      scratchpad: new Map([
        ["_todo:t1", JSON.stringify([{ id: 1, text: "old one", status: "done" }, { id: 2, text: "old two", status: "pending" }])],
        ["_todo:t2", JSON.stringify([{ id: 1, text: "other task", status: "pending" }])],
      ]),
    });
    const published: { restored: boolean; kinds: string[] }[] = [];
    const out = await Effect.runPromise(
      Effect.gen(function* () {
        const bus = yield* EventBus;
        yield* bus.on("LedgerEntryAppended", (ev) =>
          Effect.sync(() => {
            published.push({ restored: ev.restored === true, kinds: ev.entries.map((e) => String(e.kind)) });
          }),
        );
        return yield* runPass(reactKernel, input({ taskId: "t1", resumeState: legacyState }), opts({ taskId: "t1" }));
      }).pipe(
        Effect.provide(
          Layer.mergeAll(TestLLMServiceLayer([todo({ action: "list" }), FINAL]), toolLayer, EventBusLive),
        ),
      ),
    );
    expect([...out.state.scratchpad.keys()].filter((k) => k.startsWith("_todo:"))).toEqual([]);
    expect(foldAdvisory(checklistFacts(out.state.ledger)).map((i) => [i.id, i.title, i.status])).toEqual([
      ["1", "old one", "completed"],
      ["2", "old two", "pending"],
    ]);
    expect(checklistFacts(out.state.ledger).length).toBe(2);
    expect(todoObservations(out.state)[0]).toContain("[x] 1. old one");
    // Migrated facts reach consumers as ordinary increments (never inside the restored batch).
    const restored = published.filter((p) => p.restored);
    expect(restored.length).toBe(1);
    expect(restored[0]?.kinds).toEqual(["harness-signal"]);
    expect(published.slice(1).some((p) => p.kinds.includes("checklist-item"))).toBe(true);
  });

  it("brief golden: recall keys no longer include _todo:<taskId>; other keys still surface", async () => {
    // The scratchpad Ref is process-global: isolate it so other suites' keys cannot crowd the brief.
    const saved = await Effect.runPromise(
      Ref.modify(scratchpadStoreRef, (m) => [new Map(m), new Map([["probe-key", "v"]])] as const),
    );
    try {
      const pass = await runScenario(
        [todo({ action: "add", items: ["a"] }), { text: pad(), toolCall: { name: "brief", args: {} } }, FINAL],
        input({ metaTools: { todo: true, brief: true } }),
      );
      const briefObs = pass.state.steps.find(
        (s) => s.type === "observation" && s.metadata?.observationResult?.toolName === "brief",
      );
      expect(briefObs).toBeDefined();
      expect(briefObs?.content).toContain("recall: 1 keys [probe-key]");
      expect(briefObs?.content).not.toContain("_todo:");
    } finally {
      await Effect.runPromise(Ref.set(scratchpadStoreRef, saved));
    }
  });
});
