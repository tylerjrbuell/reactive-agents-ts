import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { RunStoreLive, RunStoreService } from "../../src/services/run-store.js";

const withStore = <A>(f: (store: typeof RunStoreService.Service) => Effect.Effect<A>) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const store = yield* RunStoreService;
      return yield* f(store);
    }).pipe(Effect.provide(RunStoreLive(":memory:"))),
  );

describe("run-store extensions", () => {
  test("event journal: append, seq, list after cursor", async () => {
    const events = await withStore((store) =>
      Effect.gen(function* () {
        yield* store.createRun({ runId: "r1", agentId: "a", task: "t", configHash: "h" });
        const s1 = yield* store.nextEventSeq("r1");
        yield* store.appendRunEvent("r1", s1, '{"_tag":"TextDelta","text":"a"}');
        const s2 = yield* store.nextEventSeq("r1");
        yield* store.appendRunEvent("r1", s2, '{"_tag":"TextDelta","text":"b"}');
        return {
          all: yield* store.listRunEvents("r1"),
          after1: yield* store.listRunEvents("r1", 1),
        };
      }),
    );
    expect(events.all.map((e) => e.seq)).toEqual([1, 2]);
    expect(events.after1.map((e) => e.seq)).toEqual([2]);
  });

  test("identity columns: createRun with userId, listRuns filters", async () => {
    const runs = await withStore((store) =>
      Effect.gen(function* () {
        yield* store.createRun({ runId: "u1-r", agentId: "a", task: "t", configHash: "h", userId: "u1" });
        yield* store.createRun({ runId: "u2-r", agentId: "a", task: "t", configHash: "h", userId: "u2" });
        return yield* store.listRuns({ userId: "u1" });
      }),
    );
    expect(runs.length).toBe(1);
    expect(runs[0]!.runId).toBe("u1-r");
    expect(runs[0]!.userId).toBe("u1");
  });

  test("interactions: put pending, read, decide", async () => {
    const out = await withStore((store) =>
      Effect.gen(function* () {
        yield* store.createRun({ runId: "r2", agentId: "a", task: "t", configHash: "h" });
        yield* store.putInteraction({
          runId: "r2",
          interactionId: "i1",
          kind: "choice",
          schemaJson: '{"options":["a","b"]}',
          prompt: "pick",
        });
        const pending = yield* store.getPendingInteraction("r2");
        const decided = yield* store.decideInteraction("r2", "i1", '"a"');
        const afterDecide = yield* store.getPendingInteraction("r2");
        return { pending, decided, afterDecide };
      }),
    );
    expect(out.pending?.interactionId).toBe("i1");
    expect(out.pending?.status).toBe("pending");
    expect(out.decided).toBe(true);
    expect(out.afterDecide).toBeUndefined();
  });

  test("awaiting-interaction is a valid run status", async () => {
    const run = await withStore((store) =>
      Effect.gen(function* () {
        yield* store.createRun({ runId: "r3", agentId: "a", task: "t", configHash: "h" });
        yield* store.setStatus("r3", "awaiting-interaction");
        return yield* store.getRun("r3");
      }),
    );
    expect(run?.status).toBe("awaiting-interaction");
  });
});
