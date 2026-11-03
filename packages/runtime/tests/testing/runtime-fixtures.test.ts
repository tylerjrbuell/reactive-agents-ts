import { describe, test, expect } from "bun:test";
import { Effect, Ref } from "effect";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  makeExecutionContext,
  makePhaseDeps,
  makeRuntimeConfig,
  makeTask,
} from "../../src/testing/index.js";
import type { ExecutionContext } from "../../src/types.js";
import type { PhaseDeps } from "../../src/engine/runtime-context.js";

describe("runtime fixture builders", () => {
  test("defaults are complete and valid", async () => {
    const ctx = makeExecutionContext() satisfies ExecutionContext;
    const deps = makePhaseDeps() satisfies PhaseDeps;
    expect(ctx.maxIterations).toBe(10);
    expect(ctx.metadata).toEqual({});
    expect(String(deps.task.id)).toBe("t-1");
    expect(deps.config.agentId).toBe("agent-test");
    expect(deps.obs).toBeNull();
    expect(deps.tools).toBeNull();
    const cancelled = await Effect.runPromise(Ref.get(deps.state.cancelledTasks));
    expect(cancelled.size).toBe(0);
    const out = await Effect.runPromise(deps.hooks.run("think", "after", ctx));
    expect(out).toBe(ctx);
  });

  test("overrides win and state refs are fresh per call", async () => {
    const ctx = makeExecutionContext({ iteration: 3, phase: "think" });
    expect(ctx.iteration).toBe(3);
    expect(ctx.phase).toBe("think");
    const task = makeTask({ id: "x", input: { q: 1 } });
    expect(String(task.id)).toBe("x");
    expect(makeRuntimeConfig({ defaultStrategy: "reflexion" }).defaultStrategy).toBe("reflexion");
    const a = makePhaseDeps({ task });
    const b = makePhaseDeps();
    await Effect.runPromise(Ref.update(a.state.cancelledTasks, (s) => new Set(s).add("x")));
    expect((await Effect.runPromise(Ref.get(b.state.cancelledTasks))).size).toBe(0);
    expect(a.task).toBe(task);
  });

  test("builder sources contain no double casts", () => {
    for (const f of ["runtime-fixtures.ts", "index.ts"]) {
      const src = readFileSync(join(import.meta.dir, "../../src/testing", f), "utf8");
      expect(src.includes("as unknown as")).toBe(false);
      expect(src.includes("as any")).toBe(false);
    }
  });
});
