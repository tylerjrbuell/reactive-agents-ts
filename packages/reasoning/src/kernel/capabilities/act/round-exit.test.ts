// Run: bun test packages/reasoning/src/kernel/capabilities/act/round-exit.test.ts --timeout 15000
//
// D-2026-10-28-ACT-EXIT: every act early-return (killswitch) exit folds the
// round's state through ONE helper (round-exit.ts). Each field the old
// hand-built exits dropped is pinned here per exit: observation steps,
// toolsUsed, artifact facts, gather-dedup signals.
import { describe, expect, it } from "bun:test";
import { Effect, Layer } from "effect";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { EventBusLive, HarnessPipeline, RegistrationHarness } from "@reactive-agents/core";
import { mockToolServiceLayer } from "../../../testing/tool-service-mock.js";
import { reactKernel } from "../../loop/react-kernel.js";
import { runPass } from "../../loop/run-pass.js";
import type { KernelInput, KernelRunOptions } from "../../state/kernel-state.js";

const SCHEMAS = [
  { name: "web-search", description: "search", parameters: [{ name: "q", type: "string", required: true }] },
  {
    name: "file-write",
    description: "write a file",
    parameters: [
      { name: "path", type: "string", required: true },
      { name: "content", type: "string", required: true },
    ],
  },
];

const toolLayer = mockToolServiceLayer({
  execute: (req: { toolName: string }) =>
    Effect.succeed({ success: true, result: { finding: `ok ${req.toolName} ${Math.random().toString(36).slice(2)}` } }),
  getTool: (name: string) =>
    Effect.succeed({
      name,
      description: "test",
      parameters: [{ name: "q", type: "string", required: true }],
      ...(name === "file-write" ? { produces: "file" as const } : {}),
    }),
});

let padN = 0;
const pad = (): string => {
  padN += 1;
  return Array.from({ length: 450 }, (_, i) => `w${padN}x${i}`).join(" ");
};
const search = { name: "web-search", args: { q: "same-query" } };
const write = { name: "file-write", args: { path: "out.txt", content: "hi" } };
const turn = (...cs: { name: string; args: Record<string, unknown> }[]) => ({ text: pad(), toolCalls: cs });

type PendingCtx = { iteration: number; state: { meta: { pendingToolCalls?: { name: string }[] } } };

const CASES: {
  label: string;
  when: "before" | "after";
  phase: "act" | "observe";
  order: "search-first" | "write-first";
  abortIf: (ctx: PendingCtx) => boolean;
  dedup: boolean;
}[] = [
  // before-act exits are pinned separately below: since 2026-11-18 the hooks
  // run before any call of the round executes, so there is no round state.
  { label: "after-act", when: "after", phase: "act", order: "search-first", abortIf: () => true, dedup: true },
  { label: "before-observe", when: "before", phase: "observe", order: "search-first", abortIf: () => true, dedup: true },
  { label: "after-observe", when: "after", phase: "observe", order: "search-first", abortIf: () => true, dedup: true },
];

describe("act killswitch exits carry the round's state (D-2026-10-28-ACT-EXIT)", () => {
  for (const c of CASES) {
    it(`${c.label}: observation steps, toolsUsed, artifact, dedup signal survive`, async () => {
      const reg = new RegistrationHarness();
      const hook = (ctx: PendingCtx) =>
        ctx.iteration >= 1 && c.abortIf(ctx) ? ({ abort: "stop", reason: "test-killswitch" } as const) : undefined;
      const hookFn = hook as unknown as Parameters<typeof reg.before>[1];
      if (c.when === "before") reg.before(c.phase, hookFn);
      else reg.after(c.phase, hookFn);
      const harnessPipeline = new HarnessPipeline(reg._collected as ConstructorParameters<typeof HarnessPipeline>[0]);

      const second = c.order === "search-first" ? turn(search, write) : turn(write, { name: "web-search", args: { q: "fresh-query" } });
      const pass = await Effect.runPromise(
        runPass(
          reactKernel,
          {
            task: "Search then write.",
            availableToolSchemas: SCHEMAS,
            contextProfile: { tier: "local" },
            harnessPipeline,
          } as KernelInput,
          {
            maxIterations: 6,
            strategy: "reactive",
            kernelType: "react",
            taskId: "round-exit-test",
            modelId: "llama3.2:3b",
          } as KernelRunOptions,
        ).pipe(
          Effect.provide(
            Layer.mergeAll(TestLLMServiceLayer([turn(search), second, { text: "Done." }]), toolLayer, EventBusLive),
          ),
        ),
      );

      const s = pass.state;
      expect(s.meta.terminatedBy).toBe("test-killswitch");
      // observation steps of the round
      const wrote = s.steps.some(
        (st) => st.type === "observation" && st.metadata?.observationResult?.toolName === "file-write",
      );
      expect(wrote).toBe(true);
      // toolsUsed
      expect(s.toolsUsed.has("file-write")).toBe(true);
      // artifact fact
      const ledger = s.ledger ?? [];
      expect(ledger.some((e) => e.kind === "artifact" && e.path.endsWith("out.txt"))).toBe(true);
      // gather-dedup signal
      const dedup = ledger.some((e) => e.kind === "harness-signal" && e.signal === "gather-dedup");
      expect(dedup).toBe(c.dedup);
    });
  }

  // before-act-gate.ts: the hooks run once per call before ANY call of the
  // round executes. A before-act exit keeps the earlier rounds' state and
  // carries nothing from its own round, whose calls never ran.
  it("before-act exit: no call of the round runs, even ones ahead of the denied call; earlier rounds survive", async () => {
    const reg = new RegistrationHarness();
    reg.before("act", (ctx) => {
      const pending = ctx.state.meta["pendingToolCalls"];
      const first: unknown = Array.isArray(pending) ? pending[0] : undefined;
      const name = typeof first === "object" && first !== null && "name" in first ? first.name : undefined;
      return ctx.iteration >= 1 && name === "web-search" ? { abort: "stop", reason: "test-killswitch" } : undefined;
    });
    const harnessPipeline = new HarnessPipeline(reg._collected as ConstructorParameters<typeof HarnessPipeline>[0]);
    const pass = await Effect.runPromise(
      runPass(
        reactKernel,
        { task: "Search then write.", availableToolSchemas: SCHEMAS, contextProfile: { tier: "local" }, harnessPipeline } as KernelInput,
        { maxIterations: 6, strategy: "reactive", kernelType: "react", taskId: "round-exit-test", modelId: "llama3.2:3b" } as KernelRunOptions,
      ).pipe(
        Effect.provide(
          Layer.mergeAll(
            TestLLMServiceLayer([turn(search), turn(write, { name: "web-search", args: { q: "fresh-query" } }), { text: "Done." }]),
            toolLayer,
            EventBusLive,
          ),
        ),
      ),
    );
    const s = pass.state;
    expect(s.meta.terminatedBy).toBe("test-killswitch");
    // The first round's search survives.
    expect(s.toolsUsed.has("web-search")).toBe(true);
    // The denied round's file-write sat AHEAD of the denied search and still never ran.
    expect(s.toolsUsed.has("file-write")).toBe(false);
    expect(s.steps.some((st) => st.metadata?.observationResult?.toolName === "file-write")).toBe(false);
    expect((s.ledger ?? []).some((e) => e.kind === "artifact")).toBe(false);
  });
});
