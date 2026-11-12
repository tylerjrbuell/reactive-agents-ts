// Run: bun test packages/runtime/tests/seam-bootstrap-recall-and-guardrail-abort.test.ts --timeout 20000
//
// Seam pins:
//   B1 the bootstrap phase passes the TASK id to memory.bootstrap, so a seeded
//      memory emits MemoryRecalled attributed to that task (it was agentId-only,
//      so no recall was attributable and none fired in real runs).
//   B2 an empty memory emits no MemoryRecalled.
//   A1 a GuardrailViolationError run failure is labelled abort reason "guardrail".
//
// Red-on-cut:
//   - bootstrap(ctx.agentId) without ctx.taskId -> B1 fails.
//   - drop the GuardrailViolationError branch in classifyAbortReason -> A1 fails.
import { afterEach, describe, expect, it } from "bun:test";
import { Cause, Effect, Layer } from "effect";
import { EventBus, EventBusLive, type AgentEvent } from "@reactive-agents/core";
import { MemoryService, createMemoryLayer } from "@reactive-agents/memory";
import * as fs from "node:fs";
import { bootstrap } from "../src/engine/phases/bootstrap.js";
import { classifyAbortReason } from "../src/engine/execute-run-exit.js";
import { GuardrailViolationError } from "../src/errors.js";

const DB_DIR = "/tmp/test-runtime-bootstrap-recall";

const recalledDuringBootstrap = async (seed: boolean): Promise<AgentEvent[]> => {
  const layer = createMemoryLayer("1", { agentId: "a1", dbPath: `${DB_DIR}/r.db` }).pipe(
    Layer.provideMerge(EventBusLive),
  );
  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const eb = yield* EventBus;
        const seen: AgentEvent[] = [];
        yield* eb.on("MemoryRecalled", (e) => Effect.sync(() => void seen.push(e)));
        const svc = yield* MemoryService;
        if (seed) {
          yield* svc.storeSemantic({
            id: "sem-1",
            agentId: "a1",
            content: "user prefers tabs",
            summary: "user prefers tabs",
            importance: 0.5,
            verified: false,
            tags: [],
            createdAt: new Date(),
            updatedAt: new Date(),
            accessCount: 0,
            lastAccessedAt: new Date(),
          } as never);
        }
        yield* bootstrap.run({ agentId: "a1", taskId: "task-42" } as never, {} as never);
        return seen;
      }).pipe(Effect.provide(layer)),
    ),
  );
};

describe("bootstrap phase recall attribution", () => {
  afterEach(() => {
    fs.rmSync(DB_DIR, { recursive: true, force: true });
    fs.rmSync(".reactive-agents", { recursive: true, force: true });
  });

  it("B1 seeded memory emits MemoryRecalled with the run's taskId", async () => {
    const seen = await recalledDuringBootstrap(true);
    expect(seen.length).toBeGreaterThan(0);
    for (const e of seen) expect(e._tag === "MemoryRecalled" && e.taskId).toBe("task-42");
  });

  it("B2 empty memory emits no MemoryRecalled", async () => {
    expect(await recalledDuringBootstrap(false)).toEqual([]);
  });
});

describe("abort reason", () => {
  it("A1 GuardrailViolationError maps to guardrail", () => {
    const cause = Cause.fail(new GuardrailViolationError({ message: "blocked", taskId: "t", violation: "pii" } as never));
    expect(classifyAbortReason(cause, { durationMs: 1 })).toBe("guardrail");
  });
});
