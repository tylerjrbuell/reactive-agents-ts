import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { AgentService, CoreServicesLive } from "../src/index.js";
import type { AgentId } from "../src/index.js";

describe("AgentService", () => {
  const run = <A, E>(effect: Effect.Effect<A, E, AgentService>) =>
    Effect.runPromise(effect.pipe(Effect.provide(CoreServicesLive)));

  it("should create an agent", async () => {
    const agent = await run(
      Effect.gen(function* () {
        const svc = yield* AgentService;
        return yield* svc.create({ name: "TestAgent", capabilities: [] });
      }),
    );

    expect(agent.name).toBe("TestAgent");
    expect(agent.id).toBeDefined();
  });

  it("should get an agent by id", async () => {
    const found = await run(
      Effect.gen(function* () {
        const svc = yield* AgentService;
        const created = yield* svc.create({ name: "Finder", capabilities: [] });
        return yield* svc.get(created.id);
      }),
    );

    expect(found.name).toBe("Finder");
  });

  it("should fail for missing agent", async () => {
    const result = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const svc = yield* AgentService;
        return yield* svc.get("nonexistent" as AgentId);
      }).pipe(Effect.provide(CoreServicesLive)),
    );

    expect(result._tag).toBe("Failure");
  });

  it("should list agents", async () => {
    const agents = await run(
      Effect.gen(function* () {
        const svc = yield* AgentService;
        yield* svc.create({ name: "A1", capabilities: [] });
        yield* svc.create({ name: "A2", capabilities: [] });
        return yield* svc.list();
      }),
    );

    expect(agents.length).toBe(2);
  });

  it("should delete an agent", async () => {
    const agents = await run(
      Effect.gen(function* () {
        const svc = yield* AgentService;
        const a = yield* svc.create({ name: "ToDelete", capabilities: [] });
        yield* svc.delete(a.id);
        return yield* svc.list();
      }),
    );

    expect(agents.length).toBe(0);
  });
});
