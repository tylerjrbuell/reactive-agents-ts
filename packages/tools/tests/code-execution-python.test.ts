import { Effect } from "effect";
import { describe, it, expect } from "bun:test";

import { codeExecuteHandler, codeExecuteToolFor, isShellInput } from "../src/skills/code-execution.js";

interface PyResult {
  readonly executed: boolean;
  readonly result?: unknown;
  readonly output?: string;
  readonly error?: string;
  readonly timedOut?: boolean;
  readonly shellCommand?: boolean;
}

const hostHasPython3 = Bun.spawnSync(["python3", "--version"]).exitCode === 0;
const pyIt = hostHasPython3 ? it : it.skip;

const runPy = async (
  code: string,
  config?: Parameters<typeof codeExecuteHandler>[0],
  language = "python",
): Promise<PyResult> =>
  (await Effect.runPromise(codeExecuteHandler({ sandbox: "host", ...config })({ code, language }))) as PyResult;

describe("code-execute python (host python3 subprocess)", () => {
  pyIt("runs hello and returns stdout in result and output", async () => {
    const r = await runPy("print('hello')");
    expect(r.executed).toBe(true);
    expect(r.result).toBe("hello");
    expect(r.output).toBe("hello");
  });

  pyIt("computes a sum and a mean", async () => {
    const r = await runPy("xs = [3, 5, 9]\nprint(sum(xs))\nprint(sum(xs) / len(xs))");
    expect(r.executed).toBe(true);
    expect(r.result).toBe("17\n5.666666666666667");
  });

  pyIt.each(["python3", "py", "Python"])("accepts the language label %p", async (language) => {
    const r = await runPy("print(1 + 1)", undefined, language);
    expect(r.executed).toBe(true);
    expect(r.result).toBe("2");
  });

  pyIt("empty stdout gives result null", async () => {
    const r = await runPy("x = 1");
    expect(r.executed).toBe(true);
    expect(r.result).toBeNull();
    expect(r.output).toBe("(no output)");
  });

  pyIt("runs in /tmp with a minimal env (no secrets)", async () => {
    const r = await runPy("import os\nprint(os.getcwd())\nprint(os.environ.get('RA_PY_SECRET_PROBE'))");
    process.env.RA_PY_SECRET_PROBE = "leak";
    try {
      const again = await runPy("import os\nprint(os.environ.get('RA_PY_SECRET_PROBE'))");
      expect(again.result).toBe("None");
    } finally {
      delete process.env.RA_PY_SECRET_PROBE;
    }
    expect(r.result).toBe("/tmp\nNone");
  });

  pyIt("syntax error is a never-executed failure with the python retry guide", async () => {
    const r = await runPy("xs = [1, 2 3]\nprint(xs)");
    expect(r.executed).toBe(false);
    expect(r.error).toContain("SyntaxError");
    expect(r.error).toContain("not valid Python 3");
    expect(r.error).toContain("print(sum(xs) / len(xs))");
    expect(r.error).not.toContain("code-exec-");
  });

  pyIt("a runtime exception keeps the traceback tail without the guide", async () => {
    const r = await runPy("print('before')\nraise ValueError('boom')");
    expect(r.executed).toBe(false);
    expect(r.error).toContain("ValueError: boom");
    expect(r.error).not.toContain("Retry with Python 3");
    expect(r.output).toBe("before");
  });

  pyIt("trims a long traceback to its last lines", async () => {
    const r = await runPy("def f(n):\n  return f(n + 1) if n < 60 else 1 / 0\nf(0)");
    expect(r.executed).toBe(false);
    expect((r.error ?? "").split("\n").length).toBeLessThanOrEqual(21);
    expect(r.error).toContain("ZeroDivisionError");
  });

  pyIt("kills at the timeout and keeps output printed before it", async () => {
    const r = await runPy("import time\nprint('started')\ntime.sleep(30)", { timeoutMs: 600 });
    expect(r.executed).toBe(false);
    expect(r.timedOut).toBe(true);
    expect(r.output).toBe("started");
  });

  it("missing python3 returns a clear observation and runs nothing", async () => {
    const saved = process.env.PATH;
    process.env.PATH = "/nonexistent-dir-for-test";
    try {
      const r = await runPy("print(1)");
      expect(r.executed).toBe(false);
      expect(r.error).toContain("python3 not found on the host");
      expect(r.error).toContain("Nothing was executed");
    } finally {
      process.env.PATH = saved;
    }
  });

  it("a python shell line is refused as shell input, with the python guide", async () => {
    const r = await runPy("python3 script.py");
    expect(r.executed).toBe(false);
    expect(r.shellCommand).toBe(true);
    expect(r.error).toContain("is a shell command, not Python");
    expect(r.error).toContain("Retry with Python 3");
  });

  it("real python source is not mistaken for shell input", () => {
    for (const src of ["print(1)", "import os\nprint(os.getcwd())", "xs = [1, 2]\nprint(sum(xs))", "def f(x):\n  return x"]) {
      expect(isShellInput(src)).toBe(false);
    }
    expect(isShellInput("python3 script.py")).toBe(true);
    expect(isShellInput("pip install numpy")).toBe(true);
  });

  it("javascript path is unchanged when language is javascript", async () => {
    const r = (await Effect.runPromise(
      codeExecuteHandler({ sandbox: "host" })({ code: "return 2 + 2", language: "javascript" }),
    )) as PyResult;
    expect(r.executed).toBe(true);
    expect(r.result).toBe(4);
  });

  it("description states python support and that it is not isolated", () => {
    const d = codeExecuteToolFor({ sandbox: "host" }).description;
    expect(d).toContain("Python 3");
    expect(d).toContain("language: 'python'");
    expect(d).toContain("host python3 subprocess");
    expect(d).toContain("NOT isolated");
    expect(d).toContain("print()");
  });
});
