// File-root seam pin (skills/file-root.ts).
//
// Incident: a benchmark agent's `parseDate.test.ts` landed at the repo root
// although the harness wrapped the run in `withFileRoot(tmpDir, ...)`. The
// root lived only in AsyncLocalStorage, and Effect's scheduler runs batched
// fiber resumptions in the ALS context of whichever fiber started the drain.
// One fiber running outside the root is enough: after the first yield the
// tool saw no root and resolved against `process.cwd()`.
//
// The run entry reads `capturedFileRoot()` at the synchronous boundary and
// binds it into the `fileRootSlot` run slot (Plan 9 item 1R); `getFileRoot`
// reads the run slot first.
import { afterAll, afterEach, describe, expect, it } from "bun:test";
import { Effect, Fiber } from "effect";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { childContext, rootContext } from "@reactive-agents/core";
import { bindRun, childRunScope, withRunScope } from "@reactive-agents/core/internal/run-scope";

import {
  capturedFileRoot,
  currentFileRoot,
  fileRootSlot,
  getFileRoot,
  withFileRoot,
} from "../src/skills/file-root.js";
import { fileWriteHandler } from "../src/skills/file-operations.js";

const root = mkdtempSync(path.join(tmpdir(), "file-root-seam-"));
const strays: string[] = [];

afterEach(() => {
  // A failing run would write into process.cwd(); never leave it there.
  for (const p of strays.splice(0)) rmSync(p, { force: true });
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

/** A fiber started OUTSIDE any file root, kept busy so it starts scheduler drains. */
const startPoisonFiber = () => Effect.runFork(Effect.forever(Effect.yieldNow()));

let runSeq = 0;
/**
 * What the runtime run entry does: capture the caller's ALS root at the
 * synchronous call site and bind it into the run scope.
 */
const runEntry = <A, E>(effect: Effect.Effect<A, E>): Effect.Effect<A, E> => {
  const captured = capturedFileRoot();
  const ctx = rootContext(`file-root-run-${++runSeq}`, "agent-f");
  return captured === undefined
    ? effect.pipe(withRunScope(ctx))
    : effect.pipe(withRunScope(ctx, bindRun(fileRootSlot, captured)));
};

describe("file-root seam — root survives Effect scheduling", () => {
  it("a relative file-write under a run-bound root lands in the root, not process.cwd(), with a foreign fiber running", async () => {
    const name = `seam-${randomUUID()}.test.ts`;
    strays.push(path.join(process.cwd(), name));
    const poison = startPoisonFiber();
    try {
      const result = await withFileRoot(root, () =>
        Effect.runPromise(
          runEntry(
            Effect.gen(function* () {
              yield* Effect.yieldNow();
              yield* Effect.sleep(2);
              // Tool runs on a forked child fiber, as in the kernel.
              const child = yield* Effect.fork(
                fileWriteHandler({ path: name, content: "export {}\n" }),
              );
              return yield* Fiber.join(child);
            }),
          ),
        ),
      );
      expect(result).toEqual({ written: true, path: path.join(root, name) });
      expect(existsSync(path.join(root, name))).toBe(true);
      expect(existsSync(path.join(process.cwd(), name))).toBe(false);
    } finally {
      await Effect.runPromise(Fiber.interrupt(poison));
    }
  });

  it("an escaping path is refused against the bound root", async () => {
    const name = `seam-escape-${randomUUID()}.txt`;
    const poison = startPoisonFiber();
    try {
      const exit = await withFileRoot(root, () =>
        Effect.runPromiseExit(
          runEntry(
            Effect.gen(function* () {
              yield* Effect.sleep(2);
              return yield* fileWriteHandler({ path: `../${name}`, content: "x" });
            }),
          ),
        ),
      );
      expect(exit._tag).toBe("Failure");
      expect(existsSync(path.join(path.dirname(root), name))).toBe(false);
    } finally {
      await Effect.runPromise(Fiber.interrupt(poison));
    }
  });

  it("sync getFileRoot() and currentFileRoot read the bound root after yields", async () => {
    const poison = startPoisonFiber();
    try {
      const seen = await withFileRoot(root, () =>
        Effect.runPromise(
          runEntry(
            Effect.gen(function* () {
              const out: string[] = [];
              for (let i = 0; i < 5; i++) {
                yield* Effect.yieldNow();
                yield* Effect.sleep(1);
                out.push(getFileRoot());
                out.push(yield* currentFileRoot);
              }
              return out;
            }),
          ),
        ),
      );
      expect(seen.length).toBe(10);
      expect(seen.every((r) => r === root)).toBe(true);
    } finally {
      await Effect.runPromise(Fiber.interrupt(poison));
    }
  });

  it("capturedFileRoot returns the absolute ALS root at the call site, undefined outside one", () => {
    const rel = path.relative(process.cwd(), root);
    expect(withFileRoot(rel, () => capturedFileRoot())).toBe(root);
    expect(capturedFileRoot()).toBeUndefined();
  });

  it("two concurrent runs with different roots each resolve their own root; an unbound run resolves process.cwd()", async () => {
    const rootA = path.join(root, "a");
    const rootB = path.join(root, "b");
    const probe = Effect.gen(function* () {
      const out: string[] = [];
      for (let i = 0; i < 4; i++) {
        yield* Effect.sleep(1);
        yield* Effect.yieldNow();
        out.push(getFileRoot(), yield* currentFileRoot);
      }
      return out;
    });
    const bound = (r: string, id: string) =>
      probe.pipe(withRunScope(rootContext(id, "agent-f"), bindRun(fileRootSlot, r)));
    const [a, b, none] = await Effect.runPromise(
      Effect.all([bound(rootA, "fr-a"), bound(rootB, "fr-b"), probe.pipe(withRunScope(rootContext("fr-none", "agent-f")))], {
        concurrency: "unbounded",
      }),
    );
    expect(new Set(a)).toEqual(new Set([rootA]));
    expect(new Set(b)).toEqual(new Set([rootB]));
    expect(new Set(none)).toEqual(new Set([process.cwd()]));
  });

  it("a sub-agent inherits the parent's file root", async () => {
    const parent = rootContext("fr-parent", "agent-f");
    const seen = await Effect.runPromise(
      currentFileRoot.pipe(childRunScope(childContext(parent, "sub")), withRunScope(parent, bindRun(fileRootSlot, root))),
    );
    expect(seen).toBe(root);
  });

  it("with no run scope and no ALS root, the default is process.cwd()", async () => {
    expect(getFileRoot()).toBe(process.cwd());
    expect(await Effect.runPromise(currentFileRoot)).toBe(process.cwd());
  });
});
