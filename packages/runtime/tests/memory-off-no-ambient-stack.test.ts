// Run: bun test packages/runtime/tests/memory-off-no-ambient-stack.test.ts
//
// Memory is DEFAULT-OFF — but `createRuntime` merged the full memory stack into
// the ambient runtime UNCONDITIONALLY (runtime.ts, the mergeAll). Every phase
// that gates on service PRESENCE rather than on the option therefore saw the
// services and ran. The measurable symptom, wire-captured 2026-07-10 with a
// logging proxy in front of Ollama: a 6-iteration, memory-OFF run issued a 7th
// LLM request — a 2,252-char "You are a memory extraction assistant" prompt
// (memory-extractor.ts:141) fired by the memory-flush phase, whose guard is
// `serviceOption(MemoryExtractorTag)._tag === "None"` — never false while the
// layer was ambient.
//
// One hidden LLM call per non-trivial run, on every provider, since v0.12
// declared memory "default-off". The option was off; the machinery was not.
//
// `createLightRuntime` already gated this correctly. These tests pin the same
// gate onto `createRuntime` from the OUTSIDE (service resolution through the
// built agent), so re-merging the layer unconditionally goes red here.

import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { ReactiveAgents } from "../src";
import { MemoryService } from "@reactive-agents/memory";

const resolveMemory = async (agent: unknown): Promise<"present" | "absent"> => {
  const rt = (agent as { runtime: { runPromise: <A>(e: Effect.Effect<A, never, never>) => Promise<A> } })
    .runtime;
  const opt = await rt.runPromise(
    Effect.serviceOption(MemoryService) as Effect.Effect<{ _tag: string }, never, never>,
  );
  return opt._tag === "Some" ? "present" : "absent";
};

describe("memory OFF ⇒ no ambient memory stack (no hidden extraction call)", () => {
  test("default build: MemoryService is ABSENT from the runtime context", async () => {
    const agent = await ReactiveAgents.create().withProvider("test").build();
    expect(await resolveMemory(agent)).toBe("absent");
    await agent.dispose();
  });

  test(".withMemory(): MemoryService is present — the feature still works", async () => {
    const agent = await ReactiveAgents.create().withProvider("test").withMemory().build();
    expect(await resolveMemory(agent)).toBe("present");
    await agent.dispose();
  });

  test("a memory-off run with tools completes normally without the stack", async () => {
    // The regression risk of gating: some path yield*s MemoryService
    // non-optionally. A real tool-using run through the kernel is the widest
    // net for that.
    const agent = await ReactiveAgents.create()
      .withProvider("test")
      .withTools({ builtins: ["file-read"] })
      .withReasoning({ defaultStrategy: "reactive" })
      .withMaxIterations(3)
      .build();
    const result = await agent.run("read ./x.json and report its contents");
    expect(typeof result.output).toBe("string");
    await agent.dispose();
  });
});
