import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { DatasetService, DatasetServiceLive } from "../src/services/dataset-service.js";
import type { EvalSuite } from "../src/types/eval-case.js";

const sampleSuite: EvalSuite = {
  id: "test-suite",
  name: "Test Suite",
  description: "A sample eval suite",
  cases: [
    { id: "c1", name: "Case 1", input: "Hello?", expectedOutput: "Hello!" },
    { id: "c2", name: "Case 2", input: "What is 1+1?" },
  ],
  dimensions: ["accuracy", "relevance"],
};

describe("DatasetService", () => {
  it("createSuite returns the suite as-is", async () => {
    const program = Effect.gen(function* () {
      const ds = yield* DatasetService;
      return yield* ds.createSuite(sampleSuite);
    });

    const suite = await Effect.runPromise(program.pipe(Effect.provide(DatasetServiceLive)));

    expect(suite.id).toBe("test-suite");
    expect(suite.cases).toHaveLength(2);
    expect(suite.dimensions).toEqual(["accuracy", "relevance"]);
  });

  it("loadSuite reads and validates a JSON file", async () => {
    // Write a temp file
    const tmp = `/tmp/eval-suite-test-${Date.now()}.json`;
    await Bun.write(tmp, JSON.stringify(sampleSuite));

    const program = Effect.gen(function* () {
      const ds = yield* DatasetService;
      return yield* ds.loadSuite(tmp);
    });

    const suite = await Effect.runPromise(program.pipe(Effect.provide(DatasetServiceLive)));

    expect(suite.id).toBe("test-suite");
    expect(suite.cases).toHaveLength(2);
  });

  it("loadSuite fails with DatasetError for invalid JSON", async () => {
    const tmp = `/tmp/eval-invalid-${Date.now()}.json`;
    await Bun.write(tmp, "{ invalid json ]");

    const program = Effect.gen(function* () {
      const ds = yield* DatasetService;
      return yield* ds.loadSuite(tmp);
    });

    const result = await Effect.runPromise(
      program.pipe(
        Effect.provide(DatasetServiceLive),
        Effect.either,
      ),
    );

    expect(result._tag).toBe("Left");
  });

  it("loadSuite fails with DatasetError for schema mismatch", async () => {
    const tmp = `/tmp/eval-badschema-${Date.now()}.json`;
    await Bun.write(tmp, JSON.stringify({ id: "x", name: "X" })); // missing required fields

    const program = Effect.gen(function* () {
      const ds = yield* DatasetService;
      return yield* ds.loadSuite(tmp);
    });

    const result = await Effect.runPromise(
      program.pipe(
        Effect.provide(DatasetServiceLive),
        Effect.either,
      ),
    );

    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      expect(result.left._tag).toBe("DatasetError");
    }
  });
});
