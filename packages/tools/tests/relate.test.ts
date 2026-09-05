import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { relateTool, makeRelateHandler, type RelateEntry } from "../src/skills/relate.js";

const stateWith = (
  fn: (id: string, mode: "links" | "traverse", depth: number) => Effect.Effect<readonly RelateEntry[], unknown>,
) => ({ getRelated: fn });

describe("relate tool definition", () => {
  it("has name 'relate'", () => expect(relateTool.name).toBe("relate"));
});

describe("makeRelateHandler", () => {
  it("requires an id parameter", async () => {
    const handler = makeRelateHandler(stateWith(() => Effect.succeed([])));
    await expect(Effect.runPromise(handler({}))).rejects.toThrow(/requires an "id" parameter/);
  });

  it("defaults to mode 'links' and depth 2", async () => {
    let captured: [string, string, number] | undefined;
    const handler = makeRelateHandler(
      stateWith((id, mode, depth) => {
        captured = [id, mode, depth];
        return Effect.succeed([]);
      }),
    );
    await Effect.runPromise(handler({ id: "a" }));
    expect(captured).toEqual(["a", "links", 2]);
  });

  it("passes through an explicit mode and depth, capping depth at 5", async () => {
    let captured: [string, string, number] | undefined;
    const handler = makeRelateHandler(
      stateWith((id, mode, depth) => {
        captured = [id, mode, depth];
        return Effect.succeed([]);
      }),
    );
    await Effect.runPromise(handler({ id: "a", mode: "traverse", depth: 99 }));
    expect(captured).toEqual(["a", "traverse", 5]);
  });

  it("returns the entries from the port, wrapped with id/mode", async () => {
    const entries: RelateEntry[] = [{ id: "b", preview: "content of b", strength: 0.8, type: "similar" }];
    const handler = makeRelateHandler(stateWith(() => Effect.succeed(entries)));
    const result = (await Effect.runPromise(handler({ id: "a" }))) as any;
    expect(result).toEqual({ id: "a", mode: "links", entries, truncated: false });
  });

  it("truncates at 30 entries and reports truncated: true", async () => {
    const entries: RelateEntry[] = Array.from({ length: 35 }, (_, i) => ({ id: `e${i}`, preview: `p${i}` }));
    const handler = makeRelateHandler(stateWith(() => Effect.succeed(entries)));
    const result = (await Effect.runPromise(handler({ id: "a" }))) as any;
    expect(result.entries.length).toBe(30);
    expect(result.truncated).toBe(true);
  });

  it("wraps a port failure into a ToolExecutionError naming the id", async () => {
    const handler = makeRelateHandler(stateWith(() => Effect.fail(new Error("db unreachable"))));
    await expect(Effect.runPromise(handler({ id: "a" }))).rejects.toThrow(/Relate lookup failed for "a"/);
  });
});

describe("makeRelateHandler mode 'link' (explicit relationship assertion)", () => {
  it("requires a targetId parameter", async () => {
    const handler = makeRelateHandler({ ...stateWith(() => Effect.succeed([])), link: () => Effect.void });
    await expect(Effect.runPromise(handler({ id: "a", mode: "link" }))).rejects.toThrow(
      /requires a "targetId" parameter/,
    );
  });

  it("rejects an unrecognized link type", async () => {
    const handler = makeRelateHandler({ ...stateWith(() => Effect.succeed([])), link: () => Effect.void });
    await expect(
      Effect.runPromise(handler({ id: "a", mode: "link", targetId: "b", type: "friends" })),
    ).rejects.toThrow(/invalid type "friends"/);
  });

  it("defaults type to 'similar' and strength to 1.0", async () => {
    let captured: [string, string, string, number | undefined] | undefined;
    const handler = makeRelateHandler({
      ...stateWith(() => Effect.succeed([])),
      link: (sourceId, targetId, type, strength) => {
        captured = [sourceId, targetId, type, strength];
        return Effect.void;
      },
    });
    const result = (await Effect.runPromise(handler({ id: "a", mode: "link", targetId: "b" }))) as any;
    expect(captured).toEqual(["a", "b", "similar", 1.0]);
    expect(result).toEqual({ id: "a", mode: "link", linked: true, targetId: "b", type: "similar", strength: 1.0 });
  });

  it("passes through an explicit type and strength", async () => {
    let captured: [string, string, string, number | undefined] | undefined;
    const handler = makeRelateHandler({
      ...stateWith(() => Effect.succeed([])),
      link: (sourceId, targetId, type, strength) => {
        captured = [sourceId, targetId, type, strength];
        return Effect.void;
      },
    });
    await Effect.runPromise(handler({ id: "a", mode: "link", targetId: "b", type: "contradicts", strength: 0.6 }));
    expect(captured).toEqual(["a", "b", "contradicts", 0.6]);
  });

  it("fails clearly when the adapter doesn't support link (state.link is undefined)", async () => {
    const handler = makeRelateHandler(stateWith(() => Effect.succeed([])));
    await expect(
      Effect.runPromise(handler({ id: "a", mode: "link", targetId: "b" })),
    ).rejects.toThrow(/not available/);
  });

  it("wraps a link failure into a ToolExecutionError naming both ids", async () => {
    const handler = makeRelateHandler({
      ...stateWith(() => Effect.succeed([])),
      link: () => Effect.fail(new Error("db unreachable")),
    });
    await expect(
      Effect.runPromise(handler({ id: "a", mode: "link", targetId: "b" })),
    ).rejects.toThrow(/Relate link failed \("a" -> "b"\)/);
  });
});
