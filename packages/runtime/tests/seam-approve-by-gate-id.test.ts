// Run: bun test packages/runtime/tests/seam-approve-by-gate-id.test.ts --timeout 20000
//
// Seam pin: approving/denying ONE waiting request by gateId, and a stable
// parent-scoped sub-agent memory id with unique correlation ids.
//
// Parallel gated sub-agents ask under the ROOT run id, so an answer keyed by
// runId alone always took the oldest waiter and a person could not choose.
//
// Red-on-cut:
//   - drop the gateId clause in `matches` (engine/human-gate.ts) -> G1/G2 fail
//     (the first waiter takes the second's answer).
//   - make `subAgentMemoryId` embed a timestamp -> M1 fails.
//   - drop `memoryAgentId` in `localAgentRuntimeOptions` -> M2 fails.
import { describe, it, expect } from "bun:test";
import { Effect, Fiber, Option } from "effect";
import {
  makeHumanGate,
  type HumanGateOutcome,
  type HumanGateRequest,
} from "../src/engine/human-gate.js";
import { subAgentMemoryId } from "../src/builder/build-effect/sub-agent-memory-id.js";
import { localAgentRuntimeOptions } from "../src/builder/build-effect/local-agent-tools.js";

const request = (gateId: string, subAgent: string): HumanGateRequest => ({
  kind: "approval",
  runId: "root-run",
  gateId,
  toolName: "risky-tool",
  args: { who: subAgent },
  subAgent,
  requestedAt: 1,
});

/** Two parallel waiters on one run; returns their forked outcomes. */
const twoWaiters = Effect.gen(function* () {
  const gate = makeHumanGate();
  const a = yield* Effect.fork(gate.ask(request("gate-a", "alpha")));
  const b = yield* Effect.fork(gate.ask(request("gate-b", "beta")));
  yield* Effect.yieldNow();
  yield* Effect.sleep(5);
  return { gate, a, b };
});

describe("approve/deny by gateId", () => {
  it("G1 answering gate-b releases only beta; alpha keeps waiting", async () => {
    const out = await Effect.runPromise(
      Effect.gen(function* () {
        const { gate, a, b } = yield* twoWaiters;
        const pending = yield* gate.pending();
        expect(pending.map((p) => (p.kind === "approval" ? p.gateId : ""))).toEqual(["gate-a", "gate-b"]);
        expect(pending.map((p) => (p.kind === "approval" ? p.subAgent : ""))).toEqual(["alpha", "beta"]);
        const taken = yield* gate.answer("root-run", { kind: "approval", approve: true, gateId: "gate-b" });
        expect(Option.isSome(taken)).toBe(true);
        const outB = yield* Fiber.join(b);
        const stillWaiting = yield* gate.pending();
        yield* gate.answer("root-run", { kind: "approval", approve: false, gateId: "gate-a" });
        const outA = yield* Fiber.join(a);
        return { outA, outB, stillWaiting };
      }),
    );
    expect(out.outB).toEqual({ kind: "approval", approve: true, gateId: "gate-b" } satisfies HumanGateOutcome);
    expect(out.stillWaiting.map((p) => (p.kind === "approval" ? p.gateId : ""))).toEqual(["gate-a"]);
    expect(out.outA).toMatchObject({ kind: "approval", approve: false });
  });

  it("G2 an unknown gateId takes nothing; no gateId keeps oldest-first", async () => {
    const out = await Effect.runPromise(
      Effect.gen(function* () {
        const { gate, a, b } = yield* twoWaiters;
        const none = yield* gate.answer("root-run", { kind: "approval", approve: true, gateId: "nope" });
        const oldest = yield* gate.answer("root-run", { kind: "approval", approve: true });
        const outA = yield* Fiber.join(a);
        yield* gate.answer("root-run", { kind: "approval", approve: true });
        yield* Fiber.join(b);
        return { none, oldest, outA };
      }),
    );
    expect(Option.isNone(out.none)).toBe(true);
    expect(Option.isSome(out.oldest)).toBe(true);
    expect(out.outA).toMatchObject({ kind: "approval", approve: true });
  });
});

describe("sub-agent memory identity", () => {
  it("M1 memory id is stable and parent-scoped", () => {
    expect(subAgentMemoryId("parent-1", "researcher")).toBe("sub-parent-1-researcher");
    expect(subAgentMemoryId("parent-1", "researcher")).toBe(subAgentMemoryId("parent-1", "researcher"));
    expect(subAgentMemoryId("parent-2", "researcher")).not.toBe(subAgentMemoryId("parent-1", "researcher"));
  });

  it("M2 two spawns: same memoryAgentId, different correlation agentId", () => {
    const cfg = { name: "researcher", provider: "test" } as never;
    const deps = { parentMaxCallsPerTool: undefined } as never;
    const mem = subAgentMemoryId("parent-1", "researcher");
    const one = localAgentRuntimeOptions(cfg, deps, { childAgentId: "sub-researcher-1", memoryAgentId: mem });
    const two = localAgentRuntimeOptions(cfg, deps, { childAgentId: "sub-researcher-2", memoryAgentId: mem });
    expect(one.memoryAgentId).toBe(two.memoryAgentId);
    expect(one.agentId).not.toBe(two.agentId);
  });
});
