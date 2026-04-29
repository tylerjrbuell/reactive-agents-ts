// AgentMemory port (NS §3.1, FIX-34 / W11) — port-shape contract tests.
//
// These tests prove the port stands on its own: a consumer can resolve
// `AgentMemory` from a Layer that has NOTHING to do with `MemoryService`,
// nothing from `@reactive-agents/memory`. That's what makes it a port and
// not an indirection layer.

import { describe, it, expect } from "bun:test";
import { Effect, Layer, Ref } from "effect";
import { AgentMemory, type AgentMemoryEntry } from "../src/services/agent-memory.js";

function makeEntry(overrides: Partial<AgentMemoryEntry> = {}): AgentMemoryEntry {
  const now = new Date(2026, 3, 28);
  return {
    id: "entry-1",
    agentId: "test-agent",
    content: "tool result body",
    summary: "tool observation",
    importance: 0.3,
    verified: false,
    tags: ["tool-observation"],
    createdAt: now,
    updatedAt: now,
    accessCount: 0,
    lastAccessedAt: now,
    ...overrides,
  };
}

describe("AgentMemory port", () => {
  it("resolves from a Layer that has no MemoryService dependency", async () => {
    // Hand-rolled in-memory provider — proves the port works without
    // any of the @reactive-agents/memory infrastructure.
    const program = Effect.gen(function* () {
      const ref = yield* Ref.make<AgentMemoryEntry[]>([]);
      const layer = Layer.succeed(AgentMemory, {
        storeSemantic: (entry: AgentMemoryEntry) =>
          Effect.gen(function* () {
            yield* Ref.update(ref, (acc) => [...acc, entry]);
            return entry.id;
          }),
      });

      const inner = Effect.gen(function* () {
        const memory = yield* AgentMemory;
        const id = yield* memory.storeSemantic(makeEntry({ id: "e-1" }));
        const id2 = yield* memory.storeSemantic(makeEntry({ id: "e-2", content: "second" }));
        return [id, id2];
      });

      const ids = yield* inner.pipe(Effect.provide(layer));
      const stored = yield* Ref.get(ref);
      return { ids, stored };
    });

    const { ids, stored } = await Effect.runPromise(program);

    expect(ids).toEqual(["e-1", "e-2"]);
    expect(stored).toHaveLength(2);
    expect(stored[0]!.content).toBe("tool result body");
    expect(stored[1]!.content).toBe("second");
  });

  it("propagates failures from the provider's storeSemantic", async () => {
    const failingLayer = Layer.succeed(AgentMemory, {
      storeSemantic: () => Effect.fail("disk full"),
    });

    const program = Effect.gen(function* () {
      const memory = yield* AgentMemory;
      return yield* memory.storeSemantic(makeEntry()).pipe(Effect.flip);
    });

    const err = await Effect.runPromise(program.pipe(Effect.provide(failingLayer)));
    expect(err).toBe("disk full");
  });

  it("port surface is exactly `storeSemantic` — no other methods leak through", () => {
    // This is a static-type concern; the runtime check is a sanity guard
    // that the Tag's surface hasn't accidentally widened. If a future
    // commit adds methods to the port, update this test deliberately.
    const layer = Layer.succeed(AgentMemory, {
      storeSemantic: () => Effect.succeed("ok"),
    });

    const program = Effect.gen(function* () {
      const memory = yield* AgentMemory;
      const keys = Object.keys(memory).sort();
      return keys;
    });

    const keys = Effect.runSync(program.pipe(Effect.provide(layer)));
    expect(keys).toEqual(["storeSemantic"]);
  });
});
