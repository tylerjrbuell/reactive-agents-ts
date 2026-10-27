import { describe, expect, it } from "bun:test";
import { Effect, Layer, Ref } from "effect";
import { EventBus, type AgentEvent } from "@reactive-agents/core";
import { emitLLMExchange, THINKING_EMIT_MAX } from "./diagnostics.js";

const recordingBus = (sink: Ref.Ref<readonly AgentEvent[]>) =>
  Layer.succeed(EventBus, {
    publish: (event: AgentEvent) => Ref.update(sink, (prev) => [...prev, event]),
    on: () => Effect.succeed(() => {}),
    subscribe: () => Effect.succeed(() => {}),
  });

const run = (thinking: string | undefined) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const sink = yield* Ref.make<readonly AgentEvent[]>([]);
      yield* emitLLMExchange({
        taskId: "task-1",
        iteration: 2,
        provider: "ollama",
        model: "qwen3",
        requestKind: "stream",
        messages: [{ role: "user", content: "hi" }],
        response: { content: "ok", ...(thinking !== undefined ? { thinking } : {}) },
      }).pipe(Effect.provide(recordingBus(sink)));
      const all = yield* Ref.get(sink);
      return all.flatMap((e) => (e._tag === "ThinkingEmitted" ? [e] : []));
    }),
  );

describe("emitLLMExchange -> ThinkingEmitted", () => {
  it("publishes exactly one event with readable content", async () => {
    const ev = await run("step one, step two");
    expect(ev).toHaveLength(1);
    expect(ev[0]!.content).toBe("step one, step two");
    expect(ev[0]!.taskId).toBe("task-1");
    expect(ev[0]!.iteration).toBe(2);
    expect(ev[0]!.truncated).toBeUndefined();
  });

  it("publishes nothing for absent or blank thinking", async () => {
    expect(await run(undefined)).toHaveLength(0);
    expect(await run("  \n ")).toHaveLength(0);
  });

  it("caps at 12000 chars and flags truncated", async () => {
    const ev = await run("x".repeat(THINKING_EMIT_MAX + 500));
    expect(ev).toHaveLength(1);
    expect(ev[0]!.content.length).toBe(12_000);
    expect(ev[0]!.truncated).toBe(true);
  });
});
