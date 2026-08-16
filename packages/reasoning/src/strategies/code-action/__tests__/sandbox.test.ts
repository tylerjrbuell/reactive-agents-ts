import { describe, it, expect } from "bun:test";
import { Effect, Fiber } from "effect";
import { runInSandbox } from "../sandbox.js";

/** Test-only convenience: run the sandbox Effect to a Promise, matching the
 * pre-refactor call shape these tests were written against. */
const run = <A>(effect: Effect.Effect<A, Error>) => Effect.runPromise(effect);

describe("runInSandbox", () => {
  it("executes a simple expression and returns the result", async () => {
    const code = `(async () => { return 42; })()`;
    const result = await run(runInSandbox(code, new Map()));
    expect(result.finalResult).toBe(42);
  });

  it("routes tool calls through host handlers", async () => {
    const code = `(async () => { return await add({ a: 1, b: 2 }); })()`;
    const handlers = new Map<string, (args: unknown) => Promise<unknown>>([
      ["add", async (args: unknown) => {
        const { a, b } = args as { a: number; b: number };
        return a + b;
      }],
    ]);
    const result = await run(runInSandbox(code, handlers));
    expect(result.finalResult).toBe(3);
  });

  it("records tool call log entries", async () => {
    const code = `(async () => { return await add({ a: 5, b: 5 }); })()`;
    const handlers = new Map<string, (args: unknown) => Promise<unknown>>([
      ["add", async (args: unknown) => {
        const { a, b } = args as { a: number; b: number };
        return a + b;
      }],
    ]);
    const result = await run(runInSandbox(code, handlers));
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe("add");
    expect(result.toolCalls[0].result).toBe(10);
  });

  it("rejects on code that throws", async () => {
    const code = `(async () => { throw new Error("boom"); })()`;
    await expect(run(runInSandbox(code, new Map()))).rejects.toThrow("boom");
  });

  // ── Hyphenated tool names (the builtin reality — 2026-07-11 probe p7) ──
  //
  // Every builtin is hyphenated (file-write, code-execute, web-search). The
  // sandbox passed raw names as `new Function` PARAMETER names — syntactically
  // invalid JS — so code-action hard-failed with "Unexpected token '-'" the
  // moment a real builtin was involved. Tests only ever used "add".
  it("exposes hyphenated tools under sanitized identifiers, dispatches under original names", async () => {
    const code = `(async () => { return await file_write({ path: "x.txt", content: "hi" }); })()`;
    const seen: unknown[] = [];
    const handlers = new Map<string, (args: unknown) => Promise<unknown>>([
      [
        "file-write",
        async (args: unknown) => {
          seen.push(args);
          return "written";
        },
      ],
    ]);
    const result = await run(runInSandbox(code, handlers));
    expect(result.finalResult).toBe("written");
    // Host-side dispatch + call log stay keyed by the ORIGINAL tool name.
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]!.name).toBe("file-write");
    expect(seen).toHaveLength(1);
  });

  it("executes TypeScript-annotated code (models emit TS regardless of prompt)", async () => {
    // p7 2026-07-11: one `: number` annotation killed 10/10 attempts — the
    // worker parses JS. Under bun the worker transpiles TS first.
    const code = `(async () => { const n: number = 250; const total: number = n * (n + 1) * (2 * n + 1) / 6; return total; })()`;
    const result = await run(runInSandbox(code, new Map()));
    expect(result.finalResult).toBe(5239625);
  });

  it("dedupes sanitized identifier collisions deterministically", async () => {
    const code = `(async () => { return [await a_b({}), await a_b_({})]; })()`;
    const handlers = new Map<string, (args: unknown) => Promise<unknown>>([
      ["a-b", async () => "dash"],
      ["a_b", async () => "underscore"],
    ]);
    const result = await run(runInSandbox(code, handlers));
    // First name claims its sanitized form; the collider gets a suffix.
    expect(result.finalResult).toEqual(["dash", "underscore"]);
  });
});

// ── #35: fiber-supervised cancellation ──────────────────────────────────────
//
// Interrupting the Effect fiber running runInSandbox must terminate the
// underlying Worker thread, not just abandon awaiting its result. Proven
// behaviorally: the sandboxed code calls a "started" tool, sleeps, then
// calls a "finished" tool. The fiber is interrupted during the sleep; if the
// Worker were NOT actually terminated, "finished" would still fire after the
// sleep completes in the background. It must not.
describe("runInSandbox — fiber-supervised cancellation (#35)", () => {
  it("terminates the Worker on fiber interruption, before the sandboxed code completes", async () => {
    let started = false;
    let finished = false;
    const handlers = new Map<string, (args: unknown) => Promise<unknown>>([
      ["mark-started", async () => { started = true; return null; }],
      ["mark-finished", async () => { finished = true; return null; }],
    ]);
    const code = `(async () => {
      await mark_started({});
      await new Promise((resolve) => setTimeout(resolve, 800));
      await mark_finished({});
      return "done";
    })()`;

    // Fork + wait-for-start + interrupt all run inside ONE Effect.runPromise
    // call, on one fiber tree — forking from a scope that immediately closes
    // (e.g. a bare `Effect.runPromise(Effect.fork(effect))`) interrupts the
    // child before it even starts, which would falsely "prove" the fix works.
    await Effect.runPromise(
      Effect.gen(function* () {
        const fiber = yield* Effect.fork(runInSandbox(code, handlers));

        // Wait until the sandbox has actually started (avoids interrupting
        // before the Worker even spins up, which would prove nothing).
        const waitForStart: Effect.Effect<void> = Effect.suspend(() =>
          started ? Effect.void : Effect.sleep("20 millis").pipe(Effect.flatMap(() => waitForStart)),
        );
        yield* Effect.race(waitForStart, Effect.sleep("2 seconds"));

        expect(started).toBe(true);
        expect(finished).toBe(false); // still mid-sleep at this point

        yield* Fiber.interrupt(fiber);

        // If the Worker were still running in the background (the pre-fix
        // bug), this would flip to true once its 800ms sleep elapses.
        yield* Effect.sleep("1 second");
        expect(finished).toBe(false);
      }),
    );
  });
});
