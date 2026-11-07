import { Effect } from "effect";
import { describe, it, expect, afterEach } from "bun:test";

import { codeExecuteHandler, codeExecuteToolFor, isShellInput } from "../src/skills/code-execution.js";

type CodeExecResult =
  | { executed: true; result: unknown; output: string; exitCode: number }
  | { executed: false; error: string; output?: string; exitCode?: number };

async function run(code: string): Promise<CodeExecResult> {
  return Effect.runPromise(
    codeExecuteHandler()({ code }) as Effect.Effect<CodeExecResult, never, never>,
  );
}

describe("code-execute", () => {
  it("executes simple expression via return", async () => {
    const r = await run("return 1 + 1");
    expect(r.executed).toBe(true);
    if (r.executed) {
      expect(r.result).toBe(2);
    }
  });

  it("executes code using require() (CJS compat)", async () => {
    const r = await run("const os = require('os'); return os.type()");
    expect(r.executed).toBe(true);
    if (r.executed) {
      expect(typeof r.result).toBe("string");
    }
  });

  it("executes code using dynamic import() (ESM async)", async () => {
    const r = await run("const os = await import('os'); return os.type()");
    expect(r.executed).toBe(true);
    if (r.executed) {
      expect(typeof r.result).toBe("string");
    }
  });

  it("captures console.log output", async () => {
    const r = await run("console.log(2 + 2)");
    expect(r.executed).toBe(true);
    if (r.executed) {
      expect(r.output).toBe("4");
    }
  });

  it("returns both console.log output and return value", async () => {
    const r = await run("console.log('hello'); return 42");
    expect(r.executed).toBe(true);
    if (r.executed) {
      expect(r.output).toContain("hello");
      expect(r.result).toBe(42);
    }
  });

  it("returns executed:false with error for invalid code", async () => {
    const r = await run("this is not valid javascript!!!");
    expect(r.executed).toBe(false);
    if (!r.executed) {
      expect(typeof r.error).toBe("string");
      expect(r.error.length).toBeGreaterThan(0);
    }
  });

  it("rejects stored-result key instead of code", async () => {
    const r = await run("_tool_result_1");
    expect(r.executed).toBe(false);
    if (!r.executed) {
      expect(r.error).toContain("storage key");
    }
  });

  // Truthfulness audit 2026-11-06 #3: recall is often gated off the wire, so
  // code-execute names it only when the caller says it is registered.
  describe("recall is named only when registered", () => {
    it("default refusal and description do not name recall", async () => {
      const r = await run("_tool_result_1");
      expect(r.executed).toBe(false);
      if (!r.executed) {
        expect(r.error).not.toContain("recall");
        expect(r.error).toContain("inline the text");
      }
      expect(codeExecuteToolFor().description).not.toContain("recall(");
    });

    it("with recall registered, refusal and description point at recall", async () => {
      const r = (await Effect.runPromise(
        codeExecuteHandler({ recall: true })({ code: "_tool_result_1" }) as Effect.Effect<CodeExecResult, never, never>,
      ));
      expect(r.executed).toBe(false);
      if (!r.executed) expect(r.error).toContain('recall("_tool_result_1")');
      expect(codeExecuteToolFor({ recall: true }).description).toContain("recall(key, full: true)");
    });
  });

  describe("config.sandbox override", () => {
    // Pins the fix: codeExecuteHandler used to read RA_SANDBOX directly with
    // no way to override per call, unlike its sibling shellExecuteHandler
    // (config.sandbox). config.sandbox must now win over the env var, and
    // calling with no config must be byte-identical to the historical
    // env-only behavior.
    const saved = process.env.RA_SANDBOX;
    afterEach(() => {
      if (saved === undefined) delete process.env.RA_SANDBOX;
      else process.env.RA_SANDBOX = saved;
    });

    it("config.sandbox: 'host' wins even when RA_SANDBOX=docker", async () => {
      process.env.RA_SANDBOX = "docker";
      const r = await Effect.runPromise(
        codeExecuteHandler({ sandbox: "host" })({ code: "return 1 + 1" }) as Effect.Effect<
          CodeExecResult,
          never,
          never
        >,
      );
      expect(r.executed).toBe(true);
      if (r.executed) expect(r.result).toBe(2);
    });

    it("no config falls back to the env var exactly as before", async () => {
      delete process.env.RA_SANDBOX;
      const r = await run("return 1 + 1");
      expect(r.executed).toBe(true);
    });
  });
});

// Leverage scan 2026-11-07 item 4: 9 of 9 code-execute calls in rw-7 +
// lh-debug-green were shell commands; run as JS they failed and the reply
// said "fix the code". Shell input is refused before anything runs, with a
// truthful message that names no shell tool (the kernel knows the exposed set).
// RED-ON-CUT: remove the isShellInput guard and these return executed:false
// with a syntax/reference error and no shellCommand flag.
describe("code-execute shell input", () => {
  it.each(["bun test", "npm run build", "ls -la", "cd packages/app && bun test", "$ npx tsc --noEmit", "git status\nbun test --timeout 20000"])(
    "refuses %p as a shell command and executes nothing",
    async (code) => {
      const r = (await run(code)) as { executed: boolean; shellCommand?: boolean; error?: string };
      expect(r.executed).toBe(false);
      expect(r.shellCommand).toBe(true);
      expect(r.error).toContain("is a shell command, not JavaScript/TypeScript.");
      expect(r.error).toContain("it does not run shell commands. Nothing was executed.");
      expect(r.error?.toLowerCase()).not.toContain("fix the code");
      expect(r.error).not.toContain("shell-execute");
    },
  );

  it("CONTROL: JavaScript that starts with a shell-program word still runs", async () => {
    const r = await run("const ls = [3, 1]; return ls.sort()");
    expect(r.executed).toBe(true);
    if (r.executed) expect(r.result).toEqual([1, 3]);
  });

  it("isShellInput: shell lines yes, JavaScript no", () => {
    expect(isShellInput("bun test")).toBe(true);
    expect(isShellInput("cat package.json | grep version")).toBe(true);
    expect(isShellInput("return 1 + 1")).toBe(false);
    expect(isShellInput("cat.name")).toBe(false);
    expect(isShellInput("find(items, x)")).toBe(false);
    expect(isShellInput("ls = 3")).toBe(false);
    expect(isShellInput("")).toBe(false);
  });
});
