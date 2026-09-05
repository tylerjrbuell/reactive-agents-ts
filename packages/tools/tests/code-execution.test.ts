import { Effect } from "effect";
import { describe, it, expect, afterEach } from "bun:test";

import { codeExecuteHandler } from "../src/skills/code-execution.js";

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
