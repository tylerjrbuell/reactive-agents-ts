# Effect-Free Lifecycle Hooks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users write `.withHook()` handlers as plain sync/async functions (`(ctx) => ctx | void | Promise<…>`) without importing or knowing Effect-TS, while existing Effect-returning handlers keep working unchanged.

**Architecture:** Additively widen the exported `LifecycleHook.handler` return type to a union (`ExecutionContext | void | Promise<…> | Effect<…>`). A new pure module `hooks-normalize.ts` classifies whatever a handler returns and normalizes it — `normalizeHookResult` produces an `Effect` for the registry execution path (`hooks.ts`), and `runHookResultForSideEffect` runs it for the plain-async harness-mirror path (`invokeUserHookSafely`). The Effect form stays assignable, so zero existing code or tests break.

**Tech Stack:** TypeScript (strict, no `any`), Effect-TS, Bun test runner. Monorepo package `packages/runtime`.

---

## Context an implementer needs

- **Two execution surfaces for one hook.** A hook registered via `.withHook({phase, timing, handler})` runs in two places:
  1. **Registry** — `packages/runtime/src/hooks.ts` `run()`, line ~59: `current = yield* hook.handler(current).pipe(Effect.mapError(→HookError))`. This is the Effect pipeline path; it **uses the return value** to update the `ExecutionContext` passed down the phase chain.
  2. **Harness mirror** — `packages/runtime/src/builder/api-surface.ts` `invokeUserHookSafely`, called from `packages/runtime/src/builder/wither-applies.ts:127,137`. Plain `async` world; runs the handler for compose-side observability only and **discards the return** (today it awaits a thenable but cannot run a lazy `Effect`).
- **Current type** (`packages/runtime/src/types.ts:362`): `handler: (ctx: ExecutionContext) => Effect.Effect<ExecutionContext, ExecutionError>`. A handler that *throws* compiles (return type `never`), but a handler that *returns a plain ctx* does not — that is the friction we remove.
- **Error contract (must preserve):** the registry maps any handler failure to `HookError` (`hooks.ts:60-68`, fields `{message, phase, timing, cause?}`). So `normalizeHookResult`'s error channel stays `unknown` (the raw failure) and the registry's existing `Effect.mapError` wraps it — we do NOT construct `HookError`/`ExecutionError` inside the normalizer (phase/timing live at the registry). The mirror surfaces failures via the existing `_errorHandler`/`console.warn` path in `invokeUserHookSafely`.
- **`Effect.isEffect(u: unknown): u is Effect<unknown,unknown,unknown>`** is a real export from `effect` — use it as the discriminator (NOT a duck-typed `_op` check).
- **Project rules:** strict TypeScript, no `any` casts (use `unknown` + guards). Workspace packages run from `src/` under Bun — no rebuild needed for tests. Commit messages: NO `Co-Authored-By` trailer.
- **Run a single test file:** `bun test packages/runtime/tests/<file>.test.ts`

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `packages/runtime/src/hooks-normalize.ts` | Pure classifier + normalizer for hook return values. Two exports: `normalizeHookResult` (→Effect, for registry) and `runHookResultForSideEffect` (→Promise<void>, for mirror). Plus the `RawHookResult` type. | Create |
| `packages/runtime/src/types.ts` | Re-export `RawHookResult`; widen `LifecycleHook.handler` return to `RawHookResult`. | Modify (~line 362) |
| `packages/runtime/src/hooks.ts` | Registry `run()` routes the handler through `normalizeHookResult`. | Modify (~line 59) |
| `packages/runtime/src/builder/api-surface.ts` | `invokeUserHookSafely` routes the handler result through `runHookResultForSideEffect`. | Modify (~line 91-107) |
| `packages/runtime/tests/hook-effect-free.test.ts` | Behavior + regression coverage for all return forms across both surfaces. | Create |
| `packages/runtime/src/types.ts` (JSDoc) + `apps/docs/src/content/docs/guides/hooks.md` | Show the plain form first; note Effect form still supported. | Modify |

---

### Task 1: Pure normalizer module (`normalizeHookResult`)

**Files:**
- Create: `packages/runtime/src/hooks-normalize.ts`
- Test: `packages/runtime/tests/hook-normalize.test.ts`

- [ ] **Step 1: Write the failing unit tests**

Create `packages/runtime/tests/hook-normalize.test.ts`:

```ts
import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { normalizeHookResult } from "../src/hooks-normalize.js";
import type { ExecutionContext } from "../src/types.js";

// Minimal ExecutionContext stand-in — only identity matters for these tests.
const baseCtx = { phase: "think", iteration: 1 } as unknown as ExecutionContext;
const nextCtx = { phase: "think", iteration: 2 } as unknown as ExecutionContext;

const run = <A, E>(eff: Effect.Effect<A, E>) => Effect.runPromise(eff);

describe("normalizeHookResult", () => {
  it("plain ctx return → yields that ctx", async () => {
    const out = await run(normalizeHookResult(() => nextCtx, baseCtx));
    expect(out).toBe(nextCtx);
  });

  it("void/undefined return → yields the original ctx unchanged", async () => {
    const out = await run(normalizeHookResult(() => undefined, baseCtx));
    expect(out).toBe(baseCtx);
  });

  it("Promise<ctx> return → awaits and yields it", async () => {
    const out = await run(normalizeHookResult(() => Promise.resolve(nextCtx), baseCtx));
    expect(out).toBe(nextCtx);
  });

  it("Promise<void> return → yields the original ctx", async () => {
    const out = await run(normalizeHookResult(() => Promise.resolve(undefined), baseCtx));
    expect(out).toBe(baseCtx);
  });

  it("Effect<ctx> return → runs it and yields it (back-compat)", async () => {
    const out = await run(normalizeHookResult(() => Effect.succeed(nextCtx), baseCtx));
    expect(out).toBe(nextCtx);
  });

  it("sync throw → fails the effect with the thrown error", async () => {
    const eff = normalizeHookResult(() => { throw new Error("boom"); }, baseCtx);
    const exit = await Effect.runPromiseExit(eff);
    expect(exit._tag).toBe("Failure");
  });

  it("rejected Promise → fails the effect", async () => {
    const eff = normalizeHookResult(() => Promise.reject(new Error("nope")), baseCtx);
    const exit = await Effect.runPromiseExit(eff);
    expect(exit._tag).toBe("Failure");
  });

  it("failed Effect → fails the effect (back-compat)", async () => {
    const eff = normalizeHookResult(() => Effect.fail(new Error("eff-fail")), baseCtx);
    const exit = await Effect.runPromiseExit(eff);
    expect(exit._tag).toBe("Failure");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test packages/runtime/tests/hook-normalize.test.ts`
Expected: FAIL — `Cannot find module '../src/hooks-normalize.js'` (or `normalizeHookResult is not a function`).

- [ ] **Step 3: Implement `hooks-normalize.ts` (normalizer only)**

Create `packages/runtime/src/hooks-normalize.ts`:

```ts
import { Effect } from "effect";
import type { ExecutionContext } from "./types.js";
import type { ExecutionError } from "./errors.js";

/**
 * Everything a lifecycle hook handler is allowed to return.
 *
 * Plain values (`ExecutionContext` or `void`) and `Promise`s let users write
 * hooks without importing Effect. The `Effect` form is retained for
 * backward compatibility with handlers written before the widening.
 *
 *   - return a (modified) `ExecutionContext` → it replaces the context
 *   - return `void`/`undefined`               → observe-only, context unchanged
 *   - return a `Promise` of either            → same, async
 *   - return an `Effect`                      → same, Effect (legacy form)
 */
export type RawHookResult =
  | ExecutionContext
  | void
  | Promise<ExecutionContext | void>
  | Effect.Effect<ExecutionContext, ExecutionError>;

/** Narrow a value to a thenable without an `any` cast. */
function isThenable(u: unknown): u is Promise<unknown> {
  return (
    typeof u === "object" &&
    u !== null &&
    typeof (u as { then?: unknown }).then === "function"
  );
}

/**
 * Call `handler(ctx)` and normalize whatever it returns into a single
 * `Effect` that yields the next `ExecutionContext`.
 *
 * - `void`/`undefined`         → succeed with the unchanged `ctx`
 * - `Effect`                   → run as-is (mapping a void result to `ctx`)
 * - `Promise`                  → `Effect.tryPromise` (void result → `ctx`)
 * - plain `ExecutionContext`   → succeed with it
 *
 * A synchronous throw, a rejected promise, or a failed Effect all surface on
 * the error channel as the raw cause (`unknown`). The caller (`hooks.ts`
 * registry) maps that to a `HookError` where `phase`/`timing` are in scope —
 * keeping `HookError` construction in one place.
 */
export function normalizeHookResult(
  handler: (ctx: ExecutionContext) => RawHookResult,
  ctx: ExecutionContext,
): Effect.Effect<ExecutionContext, unknown> {
  return Effect.suspend(() => {
    let raw: RawHookResult;
    try {
      raw = handler(ctx);
    } catch (err) {
      return Effect.fail(err);
    }

    if (raw === undefined || raw === null) {
      return Effect.succeed(ctx);
    }
    if (Effect.isEffect(raw)) {
      return (raw as Effect.Effect<ExecutionContext, unknown>).pipe(
        Effect.map((r) => r ?? ctx),
      );
    }
    if (isThenable(raw)) {
      return Effect.tryPromise({
        try: () => raw as Promise<ExecutionContext | void>,
        catch: (err) => err,
      }).pipe(Effect.map((r) => r ?? ctx));
    }
    return Effect.succeed(raw);
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test packages/runtime/tests/hook-normalize.test.ts`
Expected: PASS — 8 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/hooks-normalize.ts packages/runtime/tests/hook-normalize.test.ts
git commit -m "feat(hooks): normalizeHookResult — accept plain/async/Effect hook returns"
```

---

### Task 2: Side-effect runner for the harness-mirror path (`runHookResultForSideEffect`)

**Files:**
- Modify: `packages/runtime/src/hooks-normalize.ts`
- Test: `packages/runtime/tests/hook-normalize.test.ts`

- [ ] **Step 1: Add the failing tests**

Append to `packages/runtime/tests/hook-normalize.test.ts`:

```ts
import { runHookResultForSideEffect } from "../src/hooks-normalize.js";

describe("runHookResultForSideEffect", () => {
  it("awaits a Promise return", async () => {
    let ran = false;
    await runHookResultForSideEffect(
      Promise.resolve().then(() => { ran = true; }),
    );
    expect(ran).toBe(true);
  });

  it("runs an Effect return (legacy form executes for side effects)", async () => {
    let ran = false;
    await runHookResultForSideEffect(
      Effect.sync(() => { ran = true; return nextCtx; }),
    );
    expect(ran).toBe(true);
  });

  it("plain/void return resolves without throwing", async () => {
    await runHookResultForSideEffect(nextCtx);
    await runHookResultForSideEffect(undefined);
    expect(true).toBe(true);
  });

  it("a rejected Promise propagates (caller surfaces it)", async () => {
    await expect(
      runHookResultForSideEffect(Promise.reject(new Error("x"))),
    ).rejects.toThrow("x");
  });

  it("a failed Effect propagates (caller surfaces it)", async () => {
    await expect(
      runHookResultForSideEffect(Effect.fail(new Error("y"))),
    ).rejects.toBeDefined();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test packages/runtime/tests/hook-normalize.test.ts`
Expected: FAIL — `runHookResultForSideEffect is not a function`.

- [ ] **Step 3: Implement `runHookResultForSideEffect`**

Append to `packages/runtime/src/hooks-normalize.ts`:

```ts
/**
 * Run an already-produced hook return value purely for its side effects —
 * the harness-mirror path observes hooks and discards any returned context.
 *
 * Unlike {@link normalizeHookResult} this takes the *result* (not the handler)
 * because the mirror calls the handler itself inside its own try/catch. An
 * `Effect` is executed via `Effect.runPromise` (fixing a latent gap where a
 * lazy Effect previously never ran on this path); a `Promise` is awaited; a
 * plain value is ignored. Failures reject so the caller's error handler fires.
 */
export async function runHookResultForSideEffect(
  raw: RawHookResult,
): Promise<void> {
  if (raw === undefined || raw === null) return;
  if (Effect.isEffect(raw)) {
    await Effect.runPromise(raw as Effect.Effect<ExecutionContext, unknown>);
    return;
  }
  if (isThenable(raw)) {
    await raw;
  }
  // Plain ExecutionContext: observation-only path discards it.
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `bun test packages/runtime/tests/hook-normalize.test.ts`
Expected: PASS — 13 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/hooks-normalize.ts packages/runtime/tests/hook-normalize.test.ts
git commit -m "feat(hooks): runHookResultForSideEffect for the harness-mirror path"
```

---

### Task 3: Widen the `LifecycleHook` type + wire the registry

**Files:**
- Modify: `packages/runtime/src/types.ts` (~line 362)
- Modify: `packages/runtime/src/hooks.ts` (~line 59)
- Test: `packages/runtime/tests/hook-effect-free.test.ts`

- [ ] **Step 1: Write the failing registry test**

Create `packages/runtime/tests/hook-effect-free.test.ts`:

```ts
import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { LifecycleHookRegistry, LifecycleHookRegistryLive } from "../src/hooks.js";
import type { ExecutionContext, LifecycleHook } from "../src/types.js";

const ctx = (iteration: number) =>
  ({ phase: "think", iteration } as unknown as ExecutionContext);

// Run a single hook through the real registry and return the resulting ctx.
const runHook = (hook: LifecycleHook, input: ExecutionContext) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const reg = yield* LifecycleHookRegistry;
      yield* reg.register(hook);
      return yield* reg.run(hook.phase, hook.timing, input);
    }).pipe(Effect.provide(LifecycleHookRegistryLive)),
  );

describe("effect-free lifecycle hooks — registry path", () => {
  it("plain sync handler returning a modified ctx replaces the context", async () => {
    const hook: LifecycleHook = {
      phase: "think",
      timing: "after",
      handler: (c) => ({ ...c, iteration: 99 }) as ExecutionContext,
    };
    const out = await runHook(hook, ctx(1));
    expect((out as { iteration: number }).iteration).toBe(99);
  });

  it("plain sync handler returning void leaves the context unchanged", async () => {
    const input = ctx(1);
    const hook: LifecycleHook = {
      phase: "think",
      timing: "after",
      handler: () => {
        /* observe only */
      },
    };
    const out = await runHook(hook, input);
    expect(out).toBe(input);
  });

  it("async handler returning a modified ctx is awaited", async () => {
    const hook: LifecycleHook = {
      phase: "think",
      timing: "after",
      handler: async (c) => ({ ...c, iteration: 7 }) as ExecutionContext,
    };
    const out = await runHook(hook, ctx(1));
    expect((out as { iteration: number }).iteration).toBe(7);
  });

  it("legacy Effect handler still works (regression)", async () => {
    const hook: LifecycleHook = {
      phase: "think",
      timing: "after",
      handler: (c) => Effect.succeed({ ...c, iteration: 42 } as ExecutionContext),
    };
    const out = await runHook(hook, ctx(1));
    expect((out as { iteration: number }).iteration).toBe(42);
  });

  it("throwing handler fails the run as HookError", async () => {
    const hook: LifecycleHook = {
      phase: "think",
      timing: "after",
      handler: () => {
        throw new Error("hook boom");
      },
    };
    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const reg = yield* LifecycleHookRegistry;
        yield* reg.register(hook);
        return yield* reg.run("think", "after", ctx(1));
      }).pipe(Effect.provide(LifecycleHookRegistryLive)),
    );
    expect(exit._tag).toBe("Failure");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test packages/runtime/tests/hook-effect-free.test.ts`
Expected: FAIL — TypeScript rejects the plain-ctx and async handlers (`Type '...' is not assignable to type 'Effect<...>'`), and/or the void/plain cases throw at runtime because `hooks.ts` calls `yield* hook.handler(...)` directly on a non-Effect.

- [ ] **Step 3: Widen the `LifecycleHook` type**

In `packages/runtime/src/types.ts`, add the import of `RawHookResult` near the top type imports and re-export it, then change the `handler` field. Replace the existing interface (around line 362):

```ts
import type { RawHookResult } from "./hooks-normalize.js";
export type { RawHookResult } from "./hooks-normalize.js";

export interface LifecycleHook {
  /** Lifecycle phase to hook into */
  readonly phase: LifecyclePhase;
  /** When to invoke the hook relative to the phase */
  readonly timing: HookTiming;
  /**
   * Handler invoked with the current execution context.
   *
   * Return the (possibly modified) context to pass it down the phase chain,
   * or return nothing to observe without changing it. Plain values, Promises,
   * and Effects are all accepted — you do NOT need to import Effect:
   *
   * ```ts
   * handler: (ctx) => { console.log(ctx.iteration); }          // observe
   * handler: (ctx) => ({ ...ctx, foo: 1 })                      // modify
   * handler: async (ctx) => { await save(ctx); return ctx; }    // async
   * ```
   *
   * A thrown error (or rejected Promise / failed Effect) propagates as a
   * `HookError`.
   */
  readonly handler: (ctx: ExecutionContext) => RawHookResult;
}
```

> NOTE: `RawHookResult` references `ExecutionContext` and `ExecutionError`, which `hooks-normalize.ts` imports from `./types.js` and `./errors.js`. `types.ts` importing a *type* back from `hooks-normalize.ts` is a type-only cycle (`import type`), which is erased at build and safe. If `bunx tsc` complains, inline the union in `types.ts` instead and have `hooks-normalize.ts` import `RawHookResult` from `./types.js` — pick whichever keeps `tsc --noEmit` clean; verify in Step 5.

- [ ] **Step 4: Wire the registry through `normalizeHookResult`**

In `packages/runtime/src/hooks.ts`, add the import and replace the `run` loop body. Change line 1 imports to add:

```ts
import { normalizeHookResult } from "./hooks-normalize.js";
```

Replace the `for` loop inside `run` (lines ~57-71):

```ts
          let current = ctx;
          for (const hook of matching) {
            current = yield* normalizeHookResult(hook.handler, current).pipe(
              Effect.mapError(
                (cause) =>
                  new HookError({
                    message: `Hook failed for ${phase}/${timing}: ${cause}`,
                    phase,
                    timing,
                    cause,
                  }),
              ),
            );
          }
          return current;
```

- [ ] **Step 5: Run the test + typecheck to verify pass**

Run: `bun test packages/runtime/tests/hook-effect-free.test.ts`
Expected: PASS — 5 pass, 0 fail.

Run: `cd packages/runtime && bunx tsc --noEmit`
Expected: exit 0, no errors (resolve the type-cycle per the Step 3 note if it complains).

- [ ] **Step 6: Commit**

```bash
git add packages/runtime/src/types.ts packages/runtime/src/hooks.ts packages/runtime/tests/hook-effect-free.test.ts
git commit -m "feat(hooks): widen LifecycleHook.handler to accept plain/async returns"
```

---

### Task 4: Wire the harness-mirror path

**Files:**
- Modify: `packages/runtime/src/builder/api-surface.ts` (~line 91-107)
- Test: `packages/runtime/tests/hook-effect-free.test.ts`

- [ ] **Step 1: Add the failing mirror test**

Append to `packages/runtime/tests/hook-effect-free.test.ts`:

```ts
import { invokeUserHookSafely } from "../src/builder/api-surface.js";
import { ReactiveAgents } from "../src/builder.js";

describe("effect-free lifecycle hooks — harness-mirror path", () => {
  it("runs a plain async handler for its side effect", async () => {
    let ran = false;
    const builder = ReactiveAgents.create().withName("mirror-plain");
    const hook: LifecycleHook = {
      phase: "think",
      timing: "before",
      handler: async () => {
        ran = true;
      },
    };
    await invokeUserHookSafely(
      builder as never,
      hook,
      { phase: "think", iteration: 0 },
    );
    expect(ran).toBe(true);
  });

  it("runs a legacy Effect handler for its side effect (was a latent no-op)", async () => {
    let ran = false;
    const builder = ReactiveAgents.create().withName("mirror-effect");
    const hook: LifecycleHook = {
      phase: "think",
      timing: "before",
      handler: () => Effect.sync(() => {
        ran = true;
        return { phase: "think", iteration: 0 } as ExecutionContext;
      }),
    };
    await invokeUserHookSafely(
      builder as never,
      hook,
      { phase: "think", iteration: 0 },
    );
    expect(ran).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test packages/runtime/tests/hook-effect-free.test.ts`
Expected: FAIL on the Effect case — `ran` stays `false` because the current `invokeUserHookSafely` only awaits thenables and never runs a lazy Effect.

- [ ] **Step 3: Route `invokeUserHookSafely` through `runHookResultForSideEffect`**

In `packages/runtime/src/builder/api-surface.ts`, add the import:

```ts
import { runHookResultForSideEffect } from "../hooks-normalize.js";
```

Replace the result-handling block (lines ~91-107):

```ts
  let result: unknown;
  try {
    result = hook.handler({
      phase: ctx.phase,
      iteration: ctx.iteration,
    } as ExecutionContext);
  } catch (err) {
    surface(err);
    return;
  }
  try {
    await runHookResultForSideEffect(result as Parameters<typeof runHookResultForSideEffect>[0]);
  } catch (err) {
    surface(err);
  }
```

- [ ] **Step 4: Run to verify it passes**

Run: `bun test packages/runtime/tests/hook-effect-free.test.ts`
Expected: PASS — 7 pass, 0 fail.

- [ ] **Step 5: Run the existing hook-error regression suite**

Run: `bun test packages/runtime/tests/lifecycle-hook-errors.test.ts`
Expected: PASS — unchanged (the throwing/rejecting handlers still route to `withErrorHandler`).

- [ ] **Step 6: Commit**

```bash
git add packages/runtime/src/builder/api-surface.ts packages/runtime/tests/hook-effect-free.test.ts
git commit -m "fix(hooks): harness-mirror runs Effect handlers (latent no-op) via shared runner"
```

---

### Task 5: Docs — show the plain form first

**Files:**
- Modify: `packages/runtime/src/types.ts` (JSDoc on `LifecycleHook` — done in Task 3 Step 3; verify)
- Modify: `apps/docs/src/content/docs/guides/hooks.md`

- [ ] **Step 1: Update the hooks guide examples**

Open `apps/docs/src/content/docs/guides/hooks.md`. For every code sample whose hook `handler` returns `Effect.sync(...)`/`Effect.gen(...)`, replace the primary example with the plain form and add one line noting the Effect form remains valid. Example transform — replace a block like:

```ts
const hook = {
  phase: "think",
  timing: "after",
  handler: (ctx) => Effect.sync(() => {
    console.log(`iter ${ctx.iteration}`);
    return ctx;
  }),
};
```

with:

```ts
const hook = {
  phase: "think",
  timing: "after",
  // Plain function — no Effect import needed. Return nothing to observe,
  // or return a modified context to change it. async works too.
  handler: (ctx) => {
    console.log(`iter ${ctx.iteration}`);
  },
};
```

Add this note once, after the first hook example:

```md
> Hook handlers can be plain sync functions, `async` functions, or return an
> Effect. Return the (modified) context to change it, or return nothing to
> observe. Throwing (or a rejected promise / failed Effect) raises a `HookError`.
```

- [ ] **Step 2: Verify the docs site builds (link integrity)**

Run: `cd apps/docs && rm -rf dist && bunx astro build`
Expected: `Complete!` with no broken-link errors.

- [ ] **Step 3: Commit**

```bash
git add apps/docs/src/content/docs/guides/hooks.md
git commit -m "docs(hooks): lead with the Effect-free handler form"
```

---

### Task 6: Full-suite verification

**Files:** none (verification only)

- [ ] **Step 1: Build the runtime package (DTS = tsc gate)**

Run: `bunx turbo run build --filter=@reactive-agents/runtime`
Expected: `Tasks: … successful`, DTS build success (confirms the widened type + type-cycle resolution compile cleanly).

- [ ] **Step 2: Run the full runtime test suite**

Run: `bun test packages/runtime/`
Expected: 0 fail. Baseline before this work was 938 pass / 1 skip / 0 fail — expect that plus the new `hook-normalize` (13) and `hook-effect-free` (7) tests, still 0 fail.

- [ ] **Step 3: Run the as-unknown-as cast ceiling guard (no new casts)**

Run: `bun test packages/runtime/test/as-unknown-as-ceiling.test.ts`
Expected: PASS — the implementation uses `unknown` + guards, adding zero `as unknown as` sites (ceiling 66).

- [ ] **Step 4: Final commit (if any doc/memory follow-ups)**

```bash
git add -A
git commit -m "test(hooks): full-suite verification green for effect-free hooks"
```

---

## Self-Review

**Spec coverage:**
- Widen exported `LifecycleHook.handler` type → Task 3 Step 3. ✓
- Normalize at registry execution → Task 1 + Task 3 Step 4. ✓
- Both execution surfaces consistent (registry + harness mirror) → Task 3 (registry) + Task 4 (mirror). ✓
- Additive / Effect form still works → regression tests in Task 1 (Effect normalize), Task 3 (legacy Effect handler), Task 4 (mirror Effect). ✓
- Error semantics unchanged (HookError at registry, `_errorHandler` at mirror) → Task 3 Step 4 mapError preserved; Task 4 keeps `surface()`; Task 4 Step 5 runs existing regression suite. ✓
- "Relax `withHook` only", no new builder methods → confirmed: no builder-method tasks. ✓
- Testing → Tasks 1,2,3,4 each TDD; Task 6 full suite. ✓
- Docs → Task 5. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code; commands have expected output. ✓

**Type consistency:** `RawHookResult`, `normalizeHookResult(handler, ctx) → Effect<ExecutionContext, unknown>`, `runHookResultForSideEffect(raw) → Promise<void>`, `LifecycleHook.handler: (ctx) => RawHookResult` used consistently across Tasks 1–4. `HookError` fields `{message, phase, timing, cause}` match `errors.ts:27`. ✓

**Known risk flagged:** the `types.ts` ↔ `hooks-normalize.ts` type-only cycle (Task 3 Step 3 note) — resolution path given, gated by `tsc --noEmit` in Task 3 Step 5 + DTS build in Task 6 Step 1.
