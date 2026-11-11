// Run: bun test packages/runtime/tests/seam-human-gate.test.ts --timeout 20000
//
// Seam pin for engine/human-gate.ts, the per-agent registry a live run waits
// on (no durable store). Direct-import, no agent build.
//
//   G1 ask -> answer: the waiter gets the answer; `answer` hands back the run's
//      result effect, which resolves when the run settles.
//   G2 listeners see each request; `pending` lists it until answered.
//   G3 an interaction answer reaches only the waiter with the same interactionId;
//      an approval answer never reaches an interaction waiter.
//   G4 timeout: the wait ends `abandoned`, nothing stays pending.
//   G5 interrupt: the waiter is removed and the run's result fails (cancelled).
//   G6 liveApprovalDecider outside a run scope denies (fail-closed).
//
// Red-on-cut: drop the `matches` interactionId check -> G3 red; drop the
// timeout racer -> G4 times out; drop the `onInterrupt` result failure -> G5 hangs.
import { describe, it, expect } from "bun:test";
import { Effect, Exit, Fiber, Option } from "effect";
import {
  HumanGate,
  HumanGateLive,
  liveApprovalDecider,
  makeHumanGate,
  type HumanGateRequest,
} from "../src/engine/human-gate.js";
import type { AgentResult } from "../src/builder/agent-result.js";

const approval = (runId: string): HumanGateRequest => ({
  kind: "approval",
  runId,
  gateId: `g-${runId}`,
  toolName: "risky",
  args: { a: 1 },
  requestedAt: 1,
});

const interaction = (runId: string, interactionId: string): HumanGateRequest => ({
  kind: "interaction",
  runId,
  interactionId,
  interactionKind: "choice",
  prompt: "pick",
  schema: { options: ["a", "b"] },
  requestedAt: 1,
});

const fakeResult = (taskId: string): AgentResult => ({
  output: "done",
  success: true,
  taskId,
  agentId: "a",
  metadata: { duration: 1, cost: 0, tokensUsed: 0, stepsCount: 0 },
});

/** Let forked fibers reach their wait. */
const settleFibers = Effect.sleep(10);

describe("human gate seam", () => {
  it("G1 ask -> answer delivers the answer and the run's result", async () => {
    const gate = makeHumanGate();
    const out = await Effect.runPromise(
      Effect.gen(function* () {
        const waiting = yield* Effect.fork(gate.ask(approval("r1")));
        yield* settleFibers;
        const taken = yield* gate.answer("r1", { kind: "approval", approve: true, reason: "ok" });
        const outcome = yield* Fiber.join(waiting);
        expect(Option.isSome(taken)).toBe(true);
        const result = Option.getOrThrow(taken);
        yield* gate.settle("r1", Exit.succeed(fakeResult("r1")));
        return { outcome, result: yield* result };
      }),
    );
    expect(out.outcome).toEqual({ kind: "approval", approve: true, reason: "ok" });
    expect(out.result.taskId).toBe("r1");
    // Nobody waits any more: a second answer finds no waiter.
    const again = await Effect.runPromise(gate.answer("r1", { kind: "approval", approve: true }));
    expect(Option.isNone(again)).toBe(true);
  });

  it("G2 listeners see the request; pending lists it until answered", async () => {
    const gate = makeHumanGate();
    const seen: HumanGateRequest[] = [];
    await Effect.runPromise(
      Effect.gen(function* () {
        const off = yield* gate.subscribe("r2", (req) => Effect.sync(() => void seen.push(req)));
        const waiting = yield* Effect.fork(gate.ask(approval("r2")));
        yield* settleFibers;
        expect((yield* gate.pending()).map((r) => r.runId)).toEqual(["r2"]);
        yield* gate.answer("r2", { kind: "approval", approve: false });
        yield* Fiber.join(waiting);
        expect(yield* gate.pending()).toEqual([]);
        yield* off;
      }),
    );
    expect(seen.map((r) => r.kind)).toEqual(["approval"]);
  });

  it("G3 answers reach only the matching waiter", async () => {
    const gate = makeHumanGate();
    const outcome = await Effect.runPromise(
      Effect.gen(function* () {
        const waiting = yield* Effect.fork(gate.ask(interaction("r3", "i-1")));
        yield* settleFibers;
        const wrongKind = yield* gate.answer("r3", { kind: "approval", approve: true });
        const wrongId = yield* gate.answer("r3", { kind: "interaction", interactionId: "i-2", value: "a" });
        expect(Option.isNone(wrongKind)).toBe(true);
        expect(Option.isNone(wrongId)).toBe(true);
        const right = yield* gate.answer("r3", { kind: "interaction", interactionId: "i-1", value: "b" });
        expect(Option.isSome(right)).toBe(true);
        return yield* Fiber.join(waiting);
      }),
    );
    expect(outcome).toEqual({ kind: "interaction", interactionId: "i-1", value: "b" });
  });

  it("G4 timeout abandons the wait and clears it", async () => {
    const gate = makeHumanGate();
    const outcome = await Effect.runPromise(gate.ask(approval("r4"), { timeoutMs: 20 }));
    expect(outcome.kind).toBe("abandoned");
    expect(await Effect.runPromise(gate.pending())).toEqual([]);
  });

  it("G5 interrupt removes the waiter and fails the run's result", async () => {
    const gate = makeHumanGate();
    const exit = await Effect.runPromise(
      Effect.gen(function* () {
        // A second waiter on the same run holds the result cell we observe.
        const first = yield* Effect.fork(gate.ask(approval("r5")));
        yield* settleFibers;
        const taken = yield* gate.answer("r5", { kind: "approval", approve: true });
        yield* Fiber.join(first);
        const second = yield* Effect.fork(gate.ask(approval("r5")));
        yield* settleFibers;
        yield* Fiber.interrupt(second);
        expect(yield* gate.pending()).toEqual([]);
        return yield* Effect.exit(Option.getOrThrow(taken));
      }),
    );
    expect(Exit.isFailure(exit)).toBe(true);
  });

  it("G6 the live decider denies outside a run scope (fail-closed)", async () => {
    const decision = await Effect.runPromise(
      liveApprovalDecider()({ toolName: "risky", args: {}, iteration: 0 }).pipe(Effect.provide(HumanGateLive)),
    );
    expect(decision.approve).toBe(false);
    // ...and with no gate at all.
    const bare = await Effect.runPromise(liveApprovalDecider()({ toolName: "risky", args: {}, iteration: 0 }));
    expect(bare.approve).toBe(false);
    expect(HumanGate.key).toBe("@reactive-agents/runtime/HumanGate");
  });
});
