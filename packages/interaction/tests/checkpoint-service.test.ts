import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { CheckpointService, CheckpointServiceLive } from "../src/services/checkpoint-service.js";
import { EventBusLive } from "@reactive-agents/core";

const TestLayer = CheckpointServiceLive.pipe(Layer.provide(EventBusLive));

const run = <A, E>(effect: Effect.Effect<A, E, CheckpointService>) =>
  effect.pipe(Effect.provide(TestLayer), Effect.runPromise);

describe("CheckpointService", () => {
  it("should create and retrieve a checkpoint", async () => {
    const result = await run(
      Effect.gen(function* () {
        const svc = yield* CheckpointService;
        const cp = yield* svc.createCheckpoint({
          agentId: "agent-1",
          taskId: "task-1",
          milestoneName: "Phase 1",
          description: "First milestone",
        });
        expect(cp.status).toBe("pending");
        expect(cp.milestoneName).toBe("Phase 1");

        const retrieved = yield* svc.getCheckpoint(cp.id);
        expect(retrieved.id).toBe(cp.id);
        return cp;
      }),
    );
    expect(result.id).toBeDefined();
  });

  it("should resolve a checkpoint", async () => {
    const result = await run(
      Effect.gen(function* () {
        const svc = yield* CheckpointService;
        const cp = yield* svc.createCheckpoint({
          agentId: "agent-1",
          taskId: "task-1",
          milestoneName: "Review",
          description: "Needs approval",
        });
        const resolved = yield* svc.resolveCheckpoint(cp.id, "approved", "Looks good");
        expect(resolved.status).toBe("approved");
        expect(resolved.userComment).toBe("Looks good");
        return resolved;
      }),
    );
    expect(result.resolvedAt).toBeDefined();
  });

  it("should list pending checkpoints", async () => {
    const result = await run(
      Effect.gen(function* () {
        const svc = yield* CheckpointService;
        yield* svc.createCheckpoint({
          agentId: "agent-1",
          taskId: "task-1",
          milestoneName: "CP1",
          description: "First",
        });
        yield* svc.createCheckpoint({
          agentId: "agent-2",
          taskId: "task-2",
          milestoneName: "CP2",
          description: "Second",
        });

        const all = yield* svc.listPending();
        expect(all.length).toBe(2);

        const filtered = yield* svc.listPending("agent-1");
        expect(filtered.length).toBe(1);
        return all;
      }),
    );
    expect(result).toHaveLength(2);
  });
});
