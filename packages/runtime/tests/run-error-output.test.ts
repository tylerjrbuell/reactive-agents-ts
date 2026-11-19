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
import { toRunBoundaryError, unwrapError, unwrapErrorWithSuggestion } from "../src/errors.js";
import { ExecutionError } from "../src/errors.js";
import { AgentRunError } from "../src/index.js";

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

const NODE_CHILD = join(import.meta.dir, "fixtures", "agent-run-error-node-child.mjs");
const nodeAvailable = Bun.which("node") !== null;

describe("uncaught run() failure from a bad API key", () => {
  test("Bun prints the message once, with no runtime source excerpt", async () => {
    const { code, stderr } = await runChild();
    expect(code).not.toBe(0);
    // The uncaught rejection prints as one named line (the logger's "✗ [error]"
    // line is separate observability output, not the rejection).
    const rejectionLines = stderr.split("\n").filter((l) => l.startsWith("AgentRunError: "));
    expect(rejectionLines).toHaveLength(1);
    expect(rejectionLines[0]).toContain("Authentication failed for openai");
    // Bun marks each code frame with a caret line; a frameless error has none.
    const caretLines = stderr.split("\n").filter((l) => /^\s*\^\s*$/.test(l));
    expect(caretLines).toHaveLength(0);
    expect(stderr).not.toContain("errors.ts");
    expect(stderr).not.toContain("RunBoundaryError");
    expect(stderr).not.toContain("_originalTaggedError");
  }, 30000);

  test.skipIf(!nodeAvailable)("Node prints the public class name and the message once", async () => {
    const proc = Bun.spawn(["node", NODE_CHILD], { cwd: import.meta.dir, stdout: "pipe", stderr: "pipe" });
    const [stderr, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
    expect(code).not.toBe(0);
    expect(stderr).toContain("[AgentRunError: Authentication failed for anthropic: 401 invalid x-api-key]");
    expect(stderr.split("401 invalid x-api-key").length - 1).toBe(1);
    expect(stderr).not.toContain("_RunBoundaryError");
    expect(stderr).not.toContain("agent-run-error.ts");
  }, 30000);
});

describe("the boundary error's printed identity", () => {
  test("class name, instance name and constructor name agree, so Node never shows an internal name", () => {
    const mapped = toRunBoundaryError(new Error("boom"));
    expect(mapped.name).toBe("AgentRunError");
    expect(mapped.constructor.name).toBe("AgentRunError");
    expect(AgentRunError.name).toBe("AgentRunError");
    expect(mapped).toBeInstanceOf(AgentRunError);
    expect(String(mapped)).toBe("AgentRunError: boom");
    expect(mapped.stack).toBe("AgentRunError: boom");
  });

  test("the message appears once in String(err), even when the full error carries a suggestion", () => {
    const unwrapped = unwrapErrorWithSuggestion(
      new ExecutionError({ message: "401 invalid x-api-key", taskId: "t1", phase: "execution" }),
    );
    const mapped = toRunBoundaryError(unwrapped);
    expect(String(mapped).split("401 invalid x-api-key").length - 1).toBe(1);
    expect(String(mapped)).not.toContain("RunBoundaryError");
  });
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
