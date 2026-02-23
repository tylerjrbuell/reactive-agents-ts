import { describe, test, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { EventBusLive, EventBus } from "@reactive-agents/core";
import { makeThoughtTracer, ThoughtTracerService, ThoughtTracerLive } from "../src/debugging/thought-tracer.js";

// ─── Phase 3.3: Thought Tracer ───

describe("ThoughtTracer — core (Phase 3.3)", () => {
  test("recordStep adds a node to the task's thought chain", async () => {
    const chain = await Effect.runPromise(
      Effect.gen(function* () {
        const tracer = yield* makeThoughtTracer;
        yield* tracer.recordStep({
          taskId: "task-1",
          strategy: "ReAct",
          step: 1,
          totalSteps: 3,
          thought: "I need to search for information",
          action: "search(query='TypeScript')",
          observation: "Found 10 results",
        });
        return yield* tracer.getThoughtChain("task-1");
      }),
    );

    expect(chain).toHaveLength(1);
    expect(chain[0]!.taskId).toBe("task-1");
    expect(chain[0]!.strategy).toBe("ReAct");
    expect(chain[0]!.step).toBe(1);
    expect(chain[0]!.thought).toBe("I need to search for information");
    expect(chain[0]!.action).toBe("search(query='TypeScript')");
    expect(chain[0]!.observation).toBe("Found 10 results");
    expect(chain[0]!.timestamp).toBeInstanceOf(Date);
  });

  test("getThoughtChain returns empty array for unknown taskId", async () => {
    const chain = await Effect.runPromise(
      Effect.gen(function* () {
        const tracer = yield* makeThoughtTracer;
        return yield* tracer.getThoughtChain("unknown-task");
      }),
    );
    expect(chain).toHaveLength(0);
  });

  test("multiple steps accumulate in order", async () => {
    const chain = await Effect.runPromise(
      Effect.gen(function* () {
        const tracer = yield* makeThoughtTracer;
        yield* tracer.recordStep({ taskId: "t1", strategy: "ReAct", step: 1, totalSteps: 3, thought: "Step 1" });
        yield* tracer.recordStep({ taskId: "t1", strategy: "ReAct", step: 2, totalSteps: 3, thought: "Step 2" });
        yield* tracer.recordStep({ taskId: "t1", strategy: "ReAct", step: 3, totalSteps: 3, thought: "Step 3" });
        return yield* tracer.getThoughtChain("t1");
      }),
    );
    expect(chain).toHaveLength(3);
    expect(chain[0]!.step).toBe(1);
    expect(chain[1]!.step).toBe(2);
    expect(chain[2]!.step).toBe(3);
  });

  test("steps from different tasks are isolated", async () => {
    const [chainA, chainB] = await Effect.runPromise(
      Effect.gen(function* () {
        const tracer = yield* makeThoughtTracer;
        yield* tracer.recordStep({ taskId: "task-A", strategy: "ToT", step: 1, totalSteps: 1, thought: "A thought" });
        yield* tracer.recordStep({ taskId: "task-B", strategy: "ReAct", step: 1, totalSteps: 2, thought: "B thought" });
        yield* tracer.recordStep({ taskId: "task-B", strategy: "ReAct", step: 2, totalSteps: 2, thought: "B thought 2" });
        const a = yield* tracer.getThoughtChain("task-A");
        const b = yield* tracer.getThoughtChain("task-B");
        return [a, b] as const;
      }),
    );
    expect(chainA).toHaveLength(1);
    expect(chainB).toHaveLength(2);
  });

  test("clearChain removes all steps for a task", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const tracer = yield* makeThoughtTracer;
        yield* tracer.recordStep({ taskId: "t1", strategy: "ReAct", step: 1, totalSteps: 1, thought: "to delete" });
        yield* tracer.clearChain("t1");
        return yield* tracer.getThoughtChain("t1");
      }),
    );
    expect(result).toHaveLength(0);
  });

  test("clearChain only removes the specified task", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const tracer = yield* makeThoughtTracer;
        yield* tracer.recordStep({ taskId: "keep", strategy: "ReAct", step: 1, totalSteps: 1, thought: "keep this" });
        yield* tracer.recordStep({ taskId: "remove", strategy: "ReAct", step: 1, totalSteps: 1, thought: "remove this" });
        yield* tracer.clearChain("remove");
        return yield* tracer.getThoughtChain("keep");
      }),
    );
    expect(result).toHaveLength(1);
    expect(result[0]!.thought).toBe("keep this");
  });

  test("getAllTaskIds returns all task IDs with steps", async () => {
    const ids = await Effect.runPromise(
      Effect.gen(function* () {
        const tracer = yield* makeThoughtTracer;
        yield* tracer.recordStep({ taskId: "task-X", strategy: "ReAct", step: 1, totalSteps: 1 });
        yield* tracer.recordStep({ taskId: "task-Y", strategy: "ToT", step: 1, totalSteps: 1 });
        yield* tracer.recordStep({ taskId: "task-Z", strategy: "ReAct", step: 1, totalSteps: 1 });
        return yield* tracer.getAllTaskIds();
      }),
    );
    expect(ids).toHaveLength(3);
    expect(ids).toContain("task-X");
    expect(ids).toContain("task-Y");
    expect(ids).toContain("task-Z");
  });
});

describe("ThoughtTracerLive — EventBus integration (Phase 3.3)", () => {
  // Layer.provideMerge: provides EventBusLive to ThoughtTracerLive AND keeps
  // EventBus in the output so the test effect can also use it.
  const TestLayer = Layer.provideMerge(ThoughtTracerLive, EventBusLive);

  test("records steps from ReasoningStepCompleted events", async () => {
    const chain = await Effect.runPromise(
      Effect.provide(
        Effect.gen(function* () {
          const tracer = yield* ThoughtTracerService;
          const bus = yield* EventBus;

          // Publish a ReasoningStepCompleted event
          yield* bus.publish({
            _tag: "ReasoningStepCompleted",
            taskId: "bus-task-1",
            strategy: "Reflexion",
            step: 1,
            totalSteps: 2,
            thought: "First reflection",
            action: "reflect()",
          });

          yield* bus.publish({
            _tag: "ReasoningStepCompleted",
            taskId: "bus-task-1",
            strategy: "Reflexion",
            step: 2,
            totalSteps: 2,
            thought: "Second reflection",
          });

          return yield* tracer.getThoughtChain("bus-task-1");
        }),
        TestLayer,
      ),
    );

    expect(chain).toHaveLength(2);
    expect(chain[0]!.thought).toBe("First reflection");
    expect(chain[1]!.thought).toBe("Second reflection");
    expect(chain[0]!.strategy).toBe("Reflexion");
  });

  test("ignores non-ReasoningStepCompleted events", async () => {
    const ids = await Effect.runPromise(
      Effect.provide(
        Effect.gen(function* () {
          const tracer = yield* ThoughtTracerService;
          const bus = yield* EventBus;

          // Publish unrelated events
          yield* bus.publish({ _tag: "TaskCreated", taskId: "irrelevant" });
          yield* bus.publish({ _tag: "ExecutionLoopIteration", taskId: "irrelevant", iteration: 1 });

          return yield* tracer.getAllTaskIds();
        }),
        TestLayer,
      ),
    );

    expect(ids).toHaveLength(0);
  });

  test("ThoughtTracerLive works without EventBus in scope", async () => {
    // Provide ThoughtTracerLive WITHOUT EventBus — should still work
    const TracerOnly = ThoughtTracerLive.pipe(
      // Provide a stub EventBus — we just omit it to test the optional path
      // ThoughtTracerLive uses Effect.serviceOption so no hard dependency
    );

    const chain = await Effect.runPromise(
      Effect.provide(
        Effect.gen(function* () {
          const tracer = yield* ThoughtTracerService;
          yield* tracer.recordStep({
            taskId: "standalone-task",
            strategy: "ReAct",
            step: 1,
            totalSteps: 1,
            thought: "Direct record",
          });
          return yield* tracer.getThoughtChain("standalone-task");
        }),
        TracerOnly,
      ),
    );

    expect(chain).toHaveLength(1);
    expect(chain[0]!.thought).toBe("Direct record");
  });
});
