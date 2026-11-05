// Run: bun test packages/core/tests/run-scope.test.ts --timeout 15000
import { describe, expect, it } from "bun:test";
import { Effect, Exit, Fiber } from "effect";
import {
  bindRun,
  childRunScope,
  currentRunContext,
  drainRunScopeMisses,
  duplicateRunSlotNames,
  ensureRunScope,
  getRunSlot,
  getRunSlotSync,
  runSlot,
  withRunScope,
} from "../src/internal/run-scope.js";
import { childContext, rootContext } from "../src/run-context.js";

const rootSlot = runSlot<string>("test.root", { child: "inherit", initial: "cwd" });
const storeSlot = runSlot<Map<string, string>>("test.store", { child: "reset", fresh: () => new Map() });

const root = rootContext("run-1", "agent-a");

describe("run scope", () => {
  it("a run sees its bound values and fresh reset slots", async () => {
    const [r, store] = await Effect.runPromise(
      Effect.all([getRunSlot(rootSlot), getRunSlot(storeSlot)]).pipe(
        withRunScope(root, bindRun(rootSlot, "/sandbox")),
      ),
    );
    expect(r).toBe("/sandbox");
    expect(store.size).toBe(0);
  });

  it("two runs never share a reset slot's value", async () => {
    const write = (v: string) =>
      Effect.flatMap(getRunSlot(storeSlot), (s) => Effect.sync(() => (s.set("k", v), s))).pipe(withRunScope(root));
    const [a, b] = await Effect.runPromise(Effect.all([write("a"), write("b")], { concurrency: 2 }));
    expect(a).not.toBe(b);
    expect(a.get("k")).toBe("a");
    expect(b.get("k")).toBe("b");
  });

  it("a forked fiber of the run sees the run's scope", async () => {
    const seen = await Effect.runPromise(
      Effect.flatMap(Effect.fork(getRunSlot(rootSlot)), Fiber.join).pipe(withRunScope(root, bindRun(rootSlot, "/r"))),
    );
    expect(seen).toBe("/r");
  });

  it("a child inherits inherit slots, gets fresh reset slots, and carries its own context", async () => {
    const child = childContext(root, "sub");
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const parentStore = yield* getRunSlot(storeSlot);
        parentStore.set("k", "parent");
        const inChild = yield* Effect.all([getRunSlot(rootSlot), getRunSlot(storeSlot), currentRunContext]).pipe(
          childRunScope(child),
        );
        return { parentStore, inChild };
      }).pipe(withRunScope(root, bindRun(rootSlot, "/r"))),
    );
    const [r, childStore, ctx] = result.inChild;
    expect(r).toBe("/r");
    expect(childStore).not.toBe(result.parentStore);
    expect(childStore.size).toBe(0);
    expect(ctx?.parentRunId).toBe("run-1");
  });

  it("a nested root entry dies instead of silently replacing the run", async () => {
    const exit = await Effect.runPromiseExit(
      Effect.void.pipe(withRunScope(rootContext("run-2", "b")), withRunScope(root)),
    );
    expect(Exit.isFailure(exit)).toBe(true);
  });

  it("a read outside any run returns the fallback and records a miss", async () => {
    drainRunScopeMisses();
    expect(await Effect.runPromise(getRunSlot(rootSlot))).toBe("cwd");
    expect(getRunSlotSync(storeSlot)).toBe(getRunSlotSync(storeSlot));
    expect(drainRunScopeMisses()).toEqual(["test.root", "test.store", "test.store"]);
  });

  it("a read inside a run records no miss", async () => {
    drainRunScopeMisses();
    await Effect.runPromise(Effect.sync(() => getRunSlotSync(rootSlot)).pipe(withRunScope(root)));
    expect(drainRunScopeMisses()).toEqual([]);
  });

  it("ensureRunScope keeps an active run and opens one when none is active", async () => {
    const inside = await Effect.runPromise(
      currentRunContext.pipe(ensureRunScope(() => rootContext("other", "x")), withRunScope(root)),
    );
    const standalone = await Effect.runPromise(currentRunContext.pipe(ensureRunScope(() => rootContext("solo", "x"))));
    expect(inside?.runId).toBe("run-1");
    expect(standalone?.runId).toBe("solo");
  });

  it("slot names are unique", () => {
    expect(duplicateRunSlotNames()).toEqual([]);
  });
});
