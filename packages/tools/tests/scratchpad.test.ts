// File: tests/scratchpad.test.ts
import { describe, it, expect } from "bun:test";
import { Effect, Ref } from "effect";
import {
  scratchpadWriteTool,
  scratchpadReadTool,
  makeScratchpadWriteHandler,
  makeScratchpadReadHandler,
} from "../src/skills/scratchpad.js";

const makeStore = () => Ref.unsafeMake(new Map<string, string>());

describe("scratchpad-write", () => {
  it("has correct tool definition", () => {
    expect(scratchpadWriteTool.name).toBe("scratchpad-write");
    expect(scratchpadWriteTool.parameters.length).toBe(2);
    expect(scratchpadWriteTool.parameters[0]!.name).toBe("key");
    expect(scratchpadWriteTool.parameters[1]!.name).toBe("content");
  });

  it("saves a note successfully", async () => {
    const store = makeStore();
    const handler = makeScratchpadWriteHandler(store);
    const result = await Effect.runPromise(
      handler({ key: "plan", content: "Step 1: search, Step 2: write" }),
    );
    expect(result).toEqual({ saved: true, key: "plan" });
  });

  it("overwrites existing notes", async () => {
    const store = makeStore();
    const write = makeScratchpadWriteHandler(store);
    const read = makeScratchpadReadHandler(store);

    await Effect.runPromise(write({ key: "data", content: "old" }));
    await Effect.runPromise(write({ key: "data", content: "new" }));

    const result = await Effect.runPromise(read({ key: "data" }));
    expect(result).toEqual({ key: "data", content: "new" });
  });

  it("fails on missing key", async () => {
    const store = makeStore();
    const handler = makeScratchpadWriteHandler(store);
    const result = await Effect.runPromise(
      handler({ content: "no key" }).pipe(Effect.either),
    );
    expect(result._tag).toBe("Left");
  });

  it("fails on missing content", async () => {
    const store = makeStore();
    const handler = makeScratchpadWriteHandler(store);
    const result = await Effect.runPromise(
      handler({ key: "test" }).pipe(Effect.either),
    );
    expect(result._tag).toBe("Left");
  });

  it("trims key whitespace", async () => {
    const store = makeStore();
    const write = makeScratchpadWriteHandler(store);
    const read = makeScratchpadReadHandler(store);

    await Effect.runPromise(write({ key: "  plan  ", content: "trimmed" }));
    const result = await Effect.runPromise(read({ key: "plan" }));
    expect(result).toEqual({ key: "plan", content: "trimmed" });
  });
});

describe("scratchpad-read", () => {
  it("has correct tool definition", () => {
    expect(scratchpadReadTool.name).toBe("scratchpad-read");
    expect(scratchpadReadTool.parameters.length).toBe(1);
    expect(scratchpadReadTool.parameters[0]!.required).toBe(false);
  });

  it("reads a single note by key", async () => {
    const store = makeStore();
    const write = makeScratchpadWriteHandler(store);
    const read = makeScratchpadReadHandler(store);

    await Effect.runPromise(write({ key: "findings", content: "Found 3 results" }));
    const result = await Effect.runPromise(read({ key: "findings" }));
    expect(result).toEqual({ key: "findings", content: "Found 3 results" });
  });

  it("returns not-found for missing key", async () => {
    const store = makeStore();
    const read = makeScratchpadReadHandler(store);
    const result = await Effect.runPromise(read({ key: "nonexistent" }));
    expect(result).toEqual({ found: false, key: "nonexistent" });
  });

  it("lists all notes when no key provided", async () => {
    const store = makeStore();
    const write = makeScratchpadWriteHandler(store);
    const read = makeScratchpadReadHandler(store);

    await Effect.runPromise(write({ key: "a", content: "alpha" }));
    await Effect.runPromise(write({ key: "b", content: "beta" }));

    const result = (await Effect.runPromise(read({}))) as any;
    expect(result.notes).toBeDefined();
    expect(result.notes.length).toBe(2);
    expect(result.notes.some((n: any) => n.key === "a")).toBe(true);
    expect(result.notes.some((n: any) => n.key === "b")).toBe(true);
  });

  it("truncates long notes in list view", async () => {
    const store = makeStore();
    const write = makeScratchpadWriteHandler(store);
    const read = makeScratchpadReadHandler(store);

    await Effect.runPromise(write({ key: "long", content: "x".repeat(300) }));
    const result = (await Effect.runPromise(read({}))) as any;
    expect(result.notes[0].content.length).toBeLessThan(210);
    expect(result.notes[0].content).toContain("...");
  });
});
