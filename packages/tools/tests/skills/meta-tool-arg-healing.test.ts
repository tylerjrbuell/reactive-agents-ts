import { describe, it, expect } from "bun:test";
import { Effect, Ref } from "effect";
import { makeFindHandler } from "../../src/skills/find.js";
import { makeFinalAnswerHandler } from "../../src/skills/final-answer.js";
import type { RagMemoryStore } from "../../src/skills/rag-ingest.js";

describe("final-answer healing", () => {
  const run = (args: Record<string, unknown>) =>
    Effect.runPromise(makeFinalAnswerHandler({ canComplete: true })(args)) as Promise<Record<string, unknown>>;

  it("heals format/confidence casing and aliases, canonical unchanged", async () => {
    const r = await run({ output: "x", format: "MD", confidence: "Med", summary: "s" });
    expect(r.accepted).toBe(true);
    expect(r.format).toBe("markdown");
    expect(r.confidence).toBe("medium");
    const c = await run({ output: "x", format: "json".replace("json", "text"), confidence: "high" });
    expect(c.format).toBe("text");
    expect(c.confidence).toBe("high");
  });
  it("unknown format is not silently widened", async () => {
    const r = await run({ output: "x", format: "yaml" });
    expect(r.format).toBe("yaml");
  });
  it("answer/result are aliases of output", async () => {
    expect(((await run({ answer: "A" })) as { _capture: { output: string } })._capture.output).toBe("A");
    expect(((await run({ result: "R" })) as { _capture: { output: string } })._capture.output).toBe("R");
    expect(((await run({ output: "O", answer: "A" })) as { _capture: { output: string } })._capture.output).toBe("O");
  });
});

describe("find scope healing", () => {
  it("scope 'docs' searches documents like 'documents'", async () => {
    const ragStore: RagMemoryStore = new Map();
    const recall = await Effect.runPromise(Ref.make(new Map<string, string>()));
    const calls: string[] = [];
    const handler = makeFindHandler({
      ragStore,
      webSearchHandler: (a) => {
        calls.push(String(a.query));
        return Effect.succeed({ results: [] });
      },
      recallStoreRef: recall,
      config: {},
    });
    await Effect.runPromise(handler({ query: "q", scope: "internet" }));
    expect(calls).toEqual(["q"]);
  });
});
