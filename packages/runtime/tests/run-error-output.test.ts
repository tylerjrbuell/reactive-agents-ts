/**
 * What a developer sees when `agent.run()` fails at a top-level await.
 *
 * A typo'd or revoked API key is the first failure most new users hit. The
 * uncaught rejection must print as one readable error, not a wall of nested
 * source frames: Bun's uncaught-error printer renders every own `cause` and
 * every enumerable Error-valued property as its own code-frame block, which
 * once printed three (the boundary error, its `cause`, and the cause's
 * `_originalTaggedError`).
 */
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { toRunBoundaryError, unwrapError } from "../src/errors.js";
import { ExecutionError } from "../src/errors.js";

const CHILD = join(import.meta.dir, "fixtures", "bad-key-run-child.ts");

const runChild = async (): Promise<{ code: number; stderr: string }> => {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && k !== "RA_DEBUG_ERRORS" && k !== "REACTIVE_AGENTS_DEBUG") env[k] = v;
  }
  const proc = Bun.spawn(["bun", CHILD], { cwd: import.meta.dir, env, stdout: "pipe", stderr: "pipe" });
  const [stderr, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
  return { code, stderr };
};

describe("uncaught run() failure from a bad API key", () => {
  test("prints the message once, with at most one source-frame block", async () => {
    const { code, stderr } = await runChild();
    expect(code).not.toBe(0);
    expect(stderr).toContain("Authentication failed for openai");
    // Bun starts each printed error with "error: " and marks each code frame
    // with a caret line.
    const errorLines = stderr.split("\n").filter((l) => l.startsWith("error: "));
    expect(errorLines).toHaveLength(1);
    const caretLines = stderr.split("\n").filter((l) => /^\s*\^\s*$/.test(l));
    expect(caretLines.length).toBeLessThanOrEqual(1);
    expect(stderr).not.toContain("_originalTaggedError");
  }, 30000);
});

describe("the boundary error keeps everything for programmatic callers", () => {
  const tagged = new ExecutionError({ message: "boom\n  hint line", taskId: "t1", phase: "execution" });

  test("cause is the full unwrapped error, which still carries the tagged original", () => {
    const unwrapped = unwrapError(tagged);
    const mapped = toRunBoundaryError(unwrapped);
    expect(mapped.message).toBe("boom");
    expect(mapped.cause).toBe(unwrapped);
    expect(Reflect.get(unwrapped, "_originalTaggedError")).toBe(tagged);
  });

  test("neither the cause nor the tagged original is an own enumerable property", () => {
    const unwrapped = unwrapError(tagged);
    const mapped = toRunBoundaryError(unwrapped);
    expect(Object.keys(unwrapped)).not.toContain("_originalTaggedError");
    expect(Object.getOwnPropertyNames(mapped)).not.toContain("cause");
  });
});
