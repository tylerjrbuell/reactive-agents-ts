// AgentMemory port adapter — bridges MemoryService → AgentMemory.
//
// The kernel resolves the AgentMemory port (in @reactive-agents/core); the
// memory package supplies the adapter Layer that satisfies the port from a
// real MemoryService instance. This test pins the conversion: an
// AgentMemoryEntry handed to the port reaches MemoryService.storeSemantic
// as a fully-formed SemanticEntry (with branded MemoryId).

import { describe, it, expect } from "bun:test";
import { Effect, Layer, Ref } from "effect";
import { AgentMemory, type AgentMemoryEntry } from "@reactive-agents/core";
import { MemoryService } from "../src/services/memory-service.js";
import { AgentMemoryFromMemoryService } from "../src/services/agent-memory-adapter.js";
import type { SemanticEntry } from "../src/types.js";

describe("AgentMemoryFromMemoryService adapter", () => {
  it("forwards a port-level AgentMemoryEntry into MemoryService.storeSemantic as a SemanticEntry", async () => {
    const program = Effect.gen(function* () {
      const ref = yield* Ref.make<SemanticEntry[]>([]);

      // Stub MemoryService — only `storeSemantic` is exercised here. Other
      // MemoryService methods are unused by the port and intentionally
      // omitted. We cast through `unknown` because the full interface is
      // wide; the adapter only touches storeSemantic.
      const stubMemory = Layer.succeed(MemoryService, {
        storeSemantic: (entry: SemanticEntry) =>
          Effect.gen(function* () {
            yield* Ref.update(ref, (acc) => [...acc, entry]);
            return entry.id;
          }),
      } as unknown as MemoryService["Type"]);

      const adapterLayer = AgentMemoryFromMemoryService.pipe(
        Layer.provide(stubMemory),
      );

      const now = new Date(2026, 3, 28);
      const entry: AgentMemoryEntry = {
        id: "e-1",
        agentId: "agent-x",
        content: "facts about hydrogen",
        summary: "hydrogen H2",
        importance: 0.5,
        verified: true,
        tags: ["chem", "tool-observation"],
        createdAt: now,
        updatedAt: now,
        accessCount: 0,
        lastAccessedAt: now,
      };

      const inner = Effect.gen(function* () {
        const port = yield* AgentMemory;
        return yield* port.storeSemantic(entry);
      });

      const id = yield* inner.pipe(Effect.provide(adapterLayer));
      const stored = yield* Ref.get(ref);
      return { id, stored };
    });

    const { id, stored } = await Effect.runPromise(program);

    expect(id).toBe("e-1");
    expect(stored).toHaveLength(1);
    const s = stored[0]!;
    expect(s.id).toBe("e-1" as typeof s.id); // branded MemoryId
    expect(s.agentId).toBe("agent-x");
    expect(s.content).toBe("facts about hydrogen");
    expect(s.summary).toBe("hydrogen H2");
    expect(s.importance).toBe(0.5);
    expect(s.verified).toBe(true);
    expect(s.tags).toEqual(["chem", "tool-observation"]);
  });
});
