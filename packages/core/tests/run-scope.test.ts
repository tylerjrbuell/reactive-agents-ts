// Run: bun test packages/core/tests/run-scope.test.ts --timeout 15000
import { describe, expect, it } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
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

  it("slot names are unique across every package's source", () => {
    expect(duplicateDeclaredSlotNames(sourceSlotDeclarations())).toEqual([]);
  });

  it("the source scan finds the declarations and flags a repeated name", () => {
    const fixture = [
      'const a = runSlot<string>("x.one", { child: "inherit", initial: "" });',
      'const b = runSlot<Map<string, number> | null>(\n  "x.one",\n  { child: "reset", fresh: () => null },\n);',
      'const c = runSlot("x.two", { child: "inherit", initial: 0 });',
      "export function runSlot<A>(name: string, policy: RunSlotPolicy<A>) {}",
    ].join("\n");
    expect(declaredSlotNames(fixture)).toEqual(["x.one", "x.one", "x.two"]);
    expect(duplicateDeclaredSlotNames([{ file: "f.ts", names: declaredSlotNames(fixture) }])).toEqual(["x.one"]);
    expect(sourceSlotDeclarations().flatMap((d) => d.names)).toContain("core.streamSink");
  });

  it("the process registry records a name declared twice", () => {
    const before = duplicateRunSlotNames().length;
    runSlot<number>("test.dup", { child: "inherit", initial: 0 });
    runSlot<number>("test.dup", { child: "inherit", initial: 0 });
    expect(duplicateRunSlotNames().slice(before)).toEqual(["test.dup"]);
  });
});

// Slot-name uniqueness is checked on source text, not on the process registry:
// in a single-process `bun test` a package can load from both src and dist,
// which declares each of its slots twice in the registry without any real clash.
const SLOT_DECLARATION = /\brunSlot\s*(?:<[^()]*?>)?\s*\(\s*["'`]([^"'`]+)["'`]/g;

/** Every slot name declared by `runSlot(...)` calls in `source`, in order. */
function declaredSlotNames(source: string): string[] {
  return [...source.matchAll(SLOT_DECLARATION)].map((m) => m[1] as string);
}

/** Slot declarations in `packages/<pkg>/src/**\/*.ts`, skipping dist, tests and node_modules. */
function sourceSlotDeclarations(): { file: string; names: string[] }[] {
  const packagesDir = join(import.meta.dir, "..", "..");
  return readdirSync(packagesDir).flatMap((pkg) => {
    const src = join(packagesDir, pkg, "src");
    if (!existsSync(src)) return [];
    return (readdirSync(src, { recursive: true }) as string[])
      .filter((f) => f.endsWith(".ts") && !/(^|[\\/])(node_modules|dist|tests?|__tests__)([\\/]|$)/.test(f))
      .map((f) => ({ file: join(pkg, "src", f), names: declaredSlotNames(readFileSync(join(src, f), "utf8")) }))
      .filter((d) => d.names.length > 0);
  });
}

/** Names declared more than once across `decls` (each repeated name listed once). */
function duplicateDeclaredSlotNames(decls: readonly { names: readonly string[] }[]): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const name of decls.flatMap((d) => d.names)) (seen.has(name) ? dup : seen).add(name);
  return [...dup];
}
