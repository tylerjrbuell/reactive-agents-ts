// Run: bun test packages/reasoning/tests/kernel/seam-curator-decisions.test.ts --timeout 20000
//
// Seam pin for kernel/capabilities/reason/curator-decisions.ts (audit
// 2026-11-18 cleanup 6): think.ts re-emitted a `compressed` curator decision
// for every preview+ref result on every turn, so trace events grew as
// results x iterations. Each ref is now emitted once per run.
// RED-ON-CUT: drop the `emitted?.has(m.ref)` skip and the second render
// re-emits r1 (3 compressed events instead of 2).
import { describe, expect, it } from "bun:test";
import { Effect, Layer } from "effect";
import { EventBus, rootContext } from "@reactive-agents/core";
import { withRunScope } from "@reactive-agents/core/internal/run-scope";
import { emitCuratorDecisions } from "../../src/kernel/capabilities/reason/curator-decisions.js";
import type { MessageTrace } from "../../src/assembly/trace.js";

const capture = () => {
  const events: { _tag: string; action?: string; targetRef?: string }[] = [];
  const bus: EventBus["Type"] = {
    publish: (event) => {
      events.push(event as { _tag: string; action?: string; targetRef?: string });
      return Effect.void;
    },
    subscribe: () => Effect.succeed(() => {}),
    on: () => Effect.succeed(() => {}),
  };
  return { events, layer: Layer.succeed(EventBus, bus) };
};

const compressed = (ref: string): MessageTrace => ({ role: "tool_result", chars: 200, projection: "preview+ref", rawChars: 9000, budget: 500, ref });
const full = (ref: string): MessageTrace => ({ role: "tool_result", chars: 120, projection: "full", ref });
const CAP = { window: 8192, tier: "local" };

const render = (iteration: number, messages: readonly MessageTrace[]) =>
  emitCuratorDecisions({ taskId: "t", iteration, messages, capability: CAP });

const decisions = (events: readonly { _tag: string; action?: string; targetRef?: string }[]) =>
  events.filter((e) => e._tag === "CuratorDecisionEmitted").map((e) => `${e.action}:${e.targetRef}`);

describe("curator decisions: each compressed ref once per run", () => {
  it("a ref compressed on every turn is emitted once; a newly compressed ref still emits", async () => {
    const { events, layer } = capture();
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* render(1, [compressed("r1")]);
        yield* render(2, [compressed("r1"), compressed("r2")]);
        yield* render(3, [compressed("r1"), compressed("r2")]);
      }).pipe(withRunScope(rootContext("curator-dedupe", "agent")), Effect.provide(layer)),
    );
    expect(decisions(events)).toEqual(["compressed:r1", "compressed:r2"]);
  });

  it("a turn whose only compressions were already emitted does not emit a false `kept`", async () => {
    const { events, layer } = capture();
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* render(1, [compressed("r1"), full("r2")]);
        yield* render(2, [compressed("r1"), full("r2")]);
      }).pipe(withRunScope(rootContext("curator-kept", "agent")), Effect.provide(layer)),
    );
    expect(decisions(events)).toEqual(["compressed:r1"]);
  });

  it("a clean render (nothing compressed) emits one `kept` for the last result, every turn", async () => {
    const { events, layer } = capture();
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* render(1, [full("r1"), full("r2")]);
        yield* render(2, [full("r1"), full("r2")]);
      }).pipe(withRunScope(rootContext("curator-clean", "agent")), Effect.provide(layer)),
    );
    expect(decisions(events)).toEqual(["kept:r2", "kept:r2"]);
  });

  it("separate runs each emit their own compressions", async () => {
    const { events, layer } = capture();
    for (const id of ["run-a", "run-b"]) {
      await Effect.runPromise(render(1, [compressed("r1")]).pipe(withRunScope(rootContext(id, "agent")), Effect.provide(layer)));
    }
    expect(decisions(events)).toEqual(["compressed:r1", "compressed:r1"]);
  });
});
