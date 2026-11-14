import { Effect } from "effect";
import { describe, it, expect } from "bun:test";

import { codeExecuteHandler, explainCodeError, hoistModuleSyntax } from "../src/skills/code-execution.js";

interface CodeResult {
  readonly executed: boolean;
  readonly result?: unknown;
  readonly error?: string;
  readonly timedOut?: boolean;
}

const run = async (code: string, config?: Parameters<typeof codeExecuteHandler>[0]): Promise<CodeResult> =>
  (await Effect.runPromise(codeExecuteHandler({ sandbox: "host", ...config })({ code }))) as CodeResult;

describe("code-execute reliability (real Bun subprocess)", () => {
  it("computes the mean of a CSV snippet", async () => {
    const r = await run(
      "const csv = 'hour,temp\\n0,10\\n1,20\\n2,33'; " +
        "const t = csv.split('\\n').slice(1).map((l) => Number(l.split(',')[1])); " +
        "return Math.round((t.reduce((a, b) => a + b, 0) / t.length) * 100) / 100;",
    );
    expect(r.executed).toBe(true);
    expect(r.result).toBe(21);
  });

  it("runs module-style code: hoisted import and exported declaration", async () => {
    const r = await run(
      "import { basename } from 'node:path';\n" +
        "export function name(p: string): string { return basename(p); }\n" +
        "return name('/a/b/c.csv');",
    );
    expect(r.error).toBeUndefined();
    expect(r.result).toBe("c.csv");
  });

  it("surfaces a thrown error message", async () => {
    const r = await run("throw new Error('boom')");
    expect(r.executed).toBe(false);
    expect(r.error).toContain("boom");
  });

  it("surfaces a syntax error without temp path or Bun banner", async () => {
    const r = await run("return (");
    expect(r.executed).toBe(false);
    expect(r.error).toContain("Unexpected");
    expect(r.error).not.toMatch(/code-exec-/);
    expect(r.error).not.toMatch(/Bun v\d/);
  });

  it("explains a missing relative file (cwd is /tmp)", async () => {
    const r = await run("return require('fs').readFileSync('./definitely-missing.csv', 'utf8')");
    expect(r.executed).toBe(false);
    expect(r.error).toContain("ENOENT");
    expect(r.error).toContain("/tmp");
  });

  it("gives a non-empty reason when the code throws an empty value", async () => {
    const r = await run("throw ''");
    expect(r.executed).toBe(false);
    expect((r.error ?? "").length).toBeGreaterThan(20);
  });

  it("gives a non-empty reason on a silent nonzero exit", async () => {
    const r = await run("process.exit(3)");
    expect(r.executed).toBe(false);
    expect(r.error).toContain("3");
  });

  it("reports a timeout with a reason", async () => {
    const r = await run("setInterval(() => {}, 1000); await new Promise(() => {});", { timeoutMs: 400 });
    expect(r.executed).toBe(false);
    expect(r.timedOut).toBe(true);
    expect(r.error).toContain("timed out");
  });
});

describe("code-execute seam: error shaping", () => {
  it("explainCodeError never returns an empty string", () => {
    expect(explainCodeError("", "fallback reason")).toBe("fallback reason");
    expect(explainCodeError("  \n ", "fallback reason")).toBe("fallback reason");
    expect(explainCodeError("Bun v1.3.10 (Linux x64)", "fallback reason")).toBe("fallback reason");
  });

  it("explainCodeError adds the /tmp hint only for missing files", () => {
    expect(explainCodeError("ENOENT: no such file", "x")).toContain("/tmp");
    expect(explainCodeError("TypeError: nope", "x")).not.toContain("/tmp");
  });

  it("hoistModuleSyntax moves imports and strips export, leaves other lines", () => {
    const { imports, body } = hoistModuleSyntax("import a from 'a';\nexport const x = 1;\nreturn x;");
    expect(imports).toBe("import a from 'a';");
    expect(body).toBe("const x = 1;\nreturn x;");
  });
});
