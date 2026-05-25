// File: tests/kernel/loop/iterate-until.test.ts
/**
 * Invariant tests for the iterateUntil combinator.
 *
 * Prototype evidence gate per direction memo (2026-05-25):
 *   - Pure-logic correctness via TestLLM-free synthetic step functions
 *   - Termination invariants (satisfied / stagnant / max-iters / custom)
 *   - Iteration counting starts at 1 + caps at maxIters
 *   - Edge cases: maxIters=0, terminate-on-first-iter, error propagation
 */
import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import {
  iterateUntil,
  continueWith,
  terminateWith,
} from "../../../src/kernel/loop/iterate-until.js";

const run = <S, E, R>(eff: Effect.Effect<S, E, R>) =>
  Effect.runPromise(eff as Effect.Effect<S, E, never>);

describe("iterateUntil — happy paths", () => {
  it("runs step until terminate(satisfied), returns iters + reason", async () => {
    const r = await run(
      iterateUntil({
        initial: { n: 0 },
        maxIters: 10,
        step: (s) =>
          Effect.succeed(
            s.n >= 3
              ? terminateWith({ n: s.n }, { kind: "satisfied" })
              : continueWith({ n: s.n + 1 }),
          ),
      }),
    );
    expect(r.final.n).toBe(3);
    expect(r.iters).toBe(4); // iter 1: 0→1, 2: 1→2, 3: 2→3, 4: terminate
    expect(r.reason.kind).toBe("satisfied");
  });

  it("iter counter starts at 1 and increments on each step", async () => {
    const iters: number[] = [];
    const r = await run(
      iterateUntil({
        initial: undefined,
        maxIters: 3,
        step: (_s, iter) => {
          iters.push(iter);
          return Effect.succeed(continueWith(undefined));
        },
      }),
    );
    expect(iters).toEqual([1, 2, 3]);
    expect(r.iters).toBe(3);
    expect(r.reason.kind).toBe("max-iters");
  });
});

describe("iterateUntil — termination reasons", () => {
  it("stagnant reason flows through unchanged", async () => {
    const r = await run(
      iterateUntil({
        initial: undefined,
        maxIters: 5,
        step: () =>
          Effect.succeed(terminateWith(undefined, { kind: "stagnant", detail: "no progress" })),
      }),
    );
    expect(r.reason.kind).toBe("stagnant");
    if (r.reason.kind === "stagnant") {
      expect(r.reason.detail).toBe("no progress");
    }
    expect(r.iters).toBe(1);
  });

  it("custom reason with tag flows through unchanged", async () => {
    const r = await run(
      iterateUntil({
        initial: undefined,
        maxIters: 5,
        step: () =>
          Effect.succeed(
            terminateWith(undefined, { kind: "custom", tag: "budget-exceeded", detail: "1000/500 tokens" }),
          ),
      }),
    );
    expect(r.reason.kind).toBe("custom");
    if (r.reason.kind === "custom") {
      expect(r.reason.tag).toBe("budget-exceeded");
      expect(r.reason.detail).toBe("1000/500 tokens");
    }
  });

  it("max-iters reason fires when step never terminates", async () => {
    const r = await run(
      iterateUntil({
        initial: { calls: 0 },
        maxIters: 5,
        step: (s) => Effect.succeed(continueWith({ calls: s.calls + 1 })),
      }),
    );
    expect(r.final.calls).toBe(5);
    expect(r.iters).toBe(5);
    expect(r.reason.kind).toBe("max-iters");
  });
});

describe("iterateUntil — edge cases", () => {
  it("maxIters=0 returns initial state immediately, never invokes step", async () => {
    let stepInvoked = false;
    const r = await run(
      iterateUntil({
        initial: { value: "initial" },
        maxIters: 0,
        step: () => {
          stepInvoked = true;
          return Effect.succeed(continueWith({ value: "should not reach" }));
        },
      }),
    );
    expect(stepInvoked).toBe(false);
    expect(r.final.value).toBe("initial");
    expect(r.iters).toBe(0);
    expect(r.reason.kind).toBe("max-iters");
  });

  it("terminate on first iter still records iters=1", async () => {
    const r = await run(
      iterateUntil({
        initial: undefined,
        maxIters: 10,
        step: () => Effect.succeed(terminateWith(undefined, { kind: "satisfied" })),
      }),
    );
    expect(r.iters).toBe(1);
  });

  it("propagates Effect failures from step (no swallow)", async () => {
    const program = iterateUntil({
      initial: undefined,
      maxIters: 5,
      step: () => Effect.fail("step-error"),
    });
    let caught: unknown = null;
    try {
      await run(program);
    } catch (e) {
      caught = e;
    }
    expect(caught).not.toBeNull();
  });
});

// ── DRIFT CONTRACT — hand-rolled refinement loops should migrate ────────────

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

describe("drift contract — iterateUntil combinator", () => {
  it("no strategies/*.ts file may inline a hand-rolled refinement loop", () => {
    // Recipe-specific signature: `while (<counter> < <max>)` where counter is
    // a `let` declared in the strategy AND followed within 60 lines by an
    // `++` increment of the same name. This is the classic hand-rolled
    // refinement pattern (reflexion's original loop). Once iterateUntil
    // is available, new strategies should use it.
    //
    // Opt-out: `// iterate-until-exempt` comment on the line above the while.
    const stratDir = join(__dirname, "../../../src/strategies");
    const files = readdirSync(stratDir).filter((f) => f.endsWith(".ts"));
    const violations: { file: string; line: number; snippet: string }[] = [];

    for (const file of files) {
      const src = readFileSync(join(stratDir, file), "utf8");
      const lines = src.split("\n");
      const declaredCounters = new Map<string, number>(); // name → line
      // Pass 1: find `let attempt = ...` / `let iteration = ...` etc.
      for (let i = 0; i < lines.length; i++) {
        const m = (lines[i] ?? "").match(/^\s*let\s+(attempt|iteration|iter|refinement|retry)\s*=\s*\d/);
        if (m) declaredCounters.set(m[1]!, i);
      }
      if (declaredCounters.size === 0) continue;
      // Pass 2: find `while (<counter> < ...)` close to declaration.
      for (const [name, decLine] of declaredCounters) {
        for (let i = decLine; i < Math.min(lines.length, decLine + 30); i++) {
          if (new RegExp(`while\\s*\\(\\s*${name}\\s*<`).test(lines[i] ?? "")) {
            const exempt = /iterate-until-exempt/.test(lines.slice(Math.max(0, i - 3), i).join("\n"));
            if (!exempt) {
              violations.push({ file, line: i + 1, snippet: (lines[i] ?? "").trim().slice(0, 100) });
            }
          }
        }
      }
    }

    if (violations.length > 0) {
      const msg = violations
        .map((v) => `  ${v.file}:${v.line}: hand-rolled refinement loop — use iterateUntil\n    ${v.snippet}`)
        .join("\n");
      throw new Error(
        `Drift contract violated — refinement loops must route through kernel/loop/iterate-until.ts:\n${msg}`,
      );
    }
    expect(violations.length).toBe(0);
  });
});

describe("iterateUntil — state threading", () => {
  it("threads state through iterations preserving mutations", async () => {
    const r = await run(
      iterateUntil({
        initial: { accumulator: [] as readonly number[] },
        maxIters: 4,
        step: (s, iter) =>
          Effect.succeed(continueWith({ accumulator: [...s.accumulator, iter] })),
      }),
    );
    expect(r.final.accumulator).toEqual([1, 2, 3, 4]);
  });

  it("terminate returns the state passed by step (not initial)", async () => {
    const r = await run(
      iterateUntil({
        initial: { n: 0 },
        maxIters: 10,
        step: (s) =>
          s.n >= 2
            ? Effect.succeed(terminateWith({ n: s.n + 100 }, { kind: "satisfied" }))
            : Effect.succeed(continueWith({ n: s.n + 1 })),
      }),
    );
    expect(r.final.n).toBe(102); // n=2 + terminate bonus 100
  });
});
