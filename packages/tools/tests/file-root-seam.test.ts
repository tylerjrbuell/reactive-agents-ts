// File-root seam pin (skills/file-root.ts).
//
// Incident: a benchmark agent's `parseDate.test.ts` landed at the repo root
// although the harness wrapped the run in `withFileRoot(tmpDir, ...)`. The
// root lived only in AsyncLocalStorage, and Effect's scheduler runs batched
// fiber resumptions in the ALS context of whichever fiber started the drain.
// One fiber running outside the root is enough: after the first yield the
// tool saw no root and resolved against `process.cwd()`.
//
// `bindFileRoot` copies the root into a FiberRef at the run boundary;
// `getFileRoot` reads the current fiber's FiberRef first.
import { afterAll, afterEach, describe, expect, it } from "bun:test";
import { Effect, Fiber } from "effect";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";

import { bindFileRoot, currentFileRoot, getFileRoot, withFileRoot } from "../src/skills/file-root.js";
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

describe("file-root seam — root survives Effect scheduling", () => {
  it("a relative file-write under bindFileRoot lands in the root, not process.cwd(), with a foreign fiber running", async () => {
    const name = `seam-${randomUUID()}.test.ts`;
    strays.push(path.join(process.cwd(), name));
    const poison = startPoisonFiber();
    try {
      const result = await withFileRoot(root, () =>
        Effect.runPromise(
          bindFileRoot(
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
          bindFileRoot(
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
          bindFileRoot(
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

  it("an explicit root wins and is resolved to an absolute path", async () => {
    const rel = path.relative(process.cwd(), root);
    const seen = await Effect.runPromise(bindFileRoot(currentFileRoot, rel));
    expect(seen).toBe(root);
  });

  it("with no active root, bindFileRoot returns the effect unchanged and the default is process.cwd()", async () => {
    const effect = currentFileRoot;
    expect(bindFileRoot(effect)).toBe(effect);
    expect(await Effect.runPromise(bindFileRoot(effect))).toBe(process.cwd());
  });
});
