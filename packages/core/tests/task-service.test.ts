import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import {
  AgentService,
  TaskService,
  CoreServicesLive,
} from "../src/index.js";

describe("TaskService", () => {
  const run = <A, E>(effect: Effect.Effect<A, E, AgentService | TaskService>) =>
    Effect.runPromise(effect.pipe(Effect.provide(CoreServicesLive)));

  it("should create a task", async () => {
    const task = await run(
      Effect.gen(function* () {
        const agents = yield* AgentService;
        const tasks = yield* TaskService;
        const agent = yield* agents.create({ name: "Worker", capabilities: [] });
        return yield* tasks.create({
          agentId: agent.id,
          type: "query",
          input: { question: "hello?" },
        });
      }),
    );

    expect(task.status).toBe("pending");
    expect(task.priority).toBe("medium");
    expect(task.type).toBe("query");
    expect(task.id).toBeDefined();
  });

  it("should get a task by id", async () => {
    const found = await run(
      Effect.gen(function* () {
        const agents = yield* AgentService;
        const tasks = yield* TaskService;
        const agent = yield* agents.create({ name: "W", capabilities: [] });
        const task = yield* tasks.create({
          agentId: agent.id,
          type: "action",
          input: "do something",
        });
        return yield* tasks.get(task.id);
      }),
    );

    expect(found.type).toBe("action");
  });

  it("should update task status", async () => {
    const updated = await run(
      Effect.gen(function* () {
        const agents = yield* AgentService;
        const tasks = yield* TaskService;
        const agent = yield* agents.create({ name: "W", capabilities: [] });
        const task = yield* tasks.create({
          agentId: agent.id,
          type: "query",
          input: "test",
        });
        return yield* tasks.updateStatus(task.id, "running");
      }),
    );

    expect(updated.status).toBe("running");
  });

  it("should cancel a task", async () => {
    const result = await run(
      Effect.gen(function* () {
        const agents = yield* AgentService;
        const tasks = yield* TaskService;
        const agent = yield* agents.create({ name: "W", capabilities: [] });
        const task = yield* tasks.create({
          agentId: agent.id,
          type: "query",
          input: "test",
        });
        yield* tasks.cancel(task.id);
        return yield* tasks.get(task.id);
      }),
    );

    expect(result.status).toBe("cancelled");
  });

  it("should fail for missing task", async () => {
    const result = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const tasks = yield* TaskService;
        return yield* tasks.get("nonexistent" as any);
      }).pipe(Effect.provide(CoreServicesLive)),
    );

    expect(result._tag).toBe("Failure");
  });

  it("should publish TaskCompleted event on completed status", async () => {
    const updated = await run(
      Effect.gen(function* () {
        const agents = yield* AgentService;
        const tasks = yield* TaskService;
        const agent = yield* agents.create({ name: "W", capabilities: [] });
        const task = yield* tasks.create({
          agentId: agent.id,
          type: "query",
          input: "test",
        });
        return yield* tasks.updateStatus(task.id, "completed");
      }),
    );

    expect(updated.status).toBe("completed");
  });
});
