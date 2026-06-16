import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { RunStoreService, RunStoreLive } from "../src/services/run-store.js";

describe("durable HITL pause persistence shape", () => {
  it("setStatus awaiting-approval + putApproval round-trips", async () => {
    const layer = RunStoreLive(":memory:");
    const prog = Effect.gen(function* () {
      const store = yield* RunStoreService;
      yield* store.createRun({ runId: "p1", agentId: "a", task: "t", configHash: "h" });
      yield* store.setStatus("p1", "awaiting-approval");
      yield* store.putApproval({ runId: "p1", gateId: "g1", toolName: "docker", argsJson: '{"image":"x"}' });
      const run = yield* store.getRun("p1");
      const pending = yield* store.getPendingApproval("p1");
      return { run, pending };
    });
    const { run, pending } = await Effect.runPromise(prog.pipe(Effect.provide(layer)));
    expect(run?.status).toBe("awaiting-approval");
    expect(pending?.gateId).toBe("g1");
    expect(pending?.toolName).toBe("docker");
  });
});
