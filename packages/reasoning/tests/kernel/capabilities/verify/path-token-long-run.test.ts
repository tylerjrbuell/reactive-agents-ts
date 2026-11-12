// Run: bun test packages/reasoning/tests/kernel/capabilities/verify/path-token-long-run.test.ts --timeout 20000
//
// A single unbroken run (a minified one-line file tagged into a chat message)
// pinned a CPU core: PATH_TOKEN was O(n^3) on dot-free tokens (4 KB ~ 22 s in
// compileRunContract), so the turn never reached the provider.
// RED-ON-CUT: restore PATH_TOKEN in derive-conditions.ts to
// /(\.?\/?[\w./-]*[\w-]+\.[A-Za-z0-9]{1,5})/ and every timed test below blows
// its bound (the 200 KB cases do not finish).
import { describe, expect, it } from "bun:test";
import { compileRunContract } from "../../../../src/kernel/contract/run-contract.js";
import {
  PATH_TOKEN,
  deriveConditions,
  deriveDeliverableItems,
  deriveDeliverablePaths,
} from "../../../../src/kernel/capabilities/verify/derive-conditions.js";
import { deriveListedInputs, deriveWriteTargets } from "../../../../src/kernel/capabilities/verify/derive-inputs.js";

const BOUND_MS = 2000;
const timed = (f: () => unknown): number => {
  const t = performance.now();
  f();
  return performance.now() - t;
};

const RUNS: Record<string, string> = {
  "200 KB single char": "x".repeat(200_000),
  "minified-json-like": `{"a":"${"ab/".repeat(70_000)}"}`,
  "dashed run": "a-".repeat(100_000),
};

describe("PATH_TOKEN stays linear on unbroken runs", () => {
  for (const [name, body] of Object.entries(RUNS)) {
    const task = `Save the summary to ./out.md. Here is the file:\n\`\`\`\n${body}\n\`\`\``;
    it(`${name}: contract + derivers finish under ${BOUND_MS}ms`, () => {
      expect(timed(() => compileRunContract(task))).toBeLessThan(BOUND_MS);
      expect(timed(() => deriveConditions(task, ["file-write"]))).toBeLessThan(BOUND_MS);
      expect(timed(() => deriveDeliverablePaths(task))).toBeLessThan(BOUND_MS);
      expect(timed(() => deriveDeliverableItems(task))).toBeLessThan(BOUND_MS);
      expect(timed(() => deriveListedInputs(task))).toBeLessThan(BOUND_MS);
      expect(timed(() => deriveWriteTargets(task))).toBeLessThan(BOUND_MS);
    });
  }

  it("still finds real paths around a long run (behavior unchanged)", () => {
    const task = `Save the report to ./reports/out.md\n${"x".repeat(50_000)}\nthen read data/in.csv`;
    expect(deriveDeliverablePaths(task)).toContain("./reports/out.md");
  });

  it("token matches are the same as before on ordinary prose", () => {
    const re = new RegExp(PATH_TOKEN.source, "g");
    const hits = [..."see ./a/b.md, src/x.test.ts and (README.md) e.g. v1.2".matchAll(re)].map((m) => m[0]);
    expect(hits).toEqual(["./a/b.md", "src/x.test.ts", "README.md", "e.g", "v1.2"]);
  });
});
