// Run: bun run repo test packages/benchmarks/tests/sim/provenance.test.ts
// bench:sim report header names the reasoning source it ran. Zero tokens.
import { describe, expect, it } from "bun:test";
import { formatKernelProvenance, kernelProvenance, type GitRunner } from "./provenance.js";

const fakeGit = (status: string): GitRunner => (args) => {
  if (args[0] === "rev-parse") return "c9ab8d29e4c59e3e79d72f1ce0cdfdc77fdb2a89";
  if (args[0] === "log") return "917b865b7aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  return status;
};

describe("kernel provenance", () => {
  it("clean tree: names the src commit and HEAD, flags clean", () => {
    const p = kernelProvenance(fakeGit(""), "file:///x/packages/reasoning/src/index.ts");
    expect(p).toMatchObject({ srcCommit: "917b865b7aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", dirty: false });
    const line = formatKernelProvenance(p);
    expect(line).toContain("917b865b7");
    expect(line).toContain("HEAD c9ab8d29e");
    expect(line).toContain("clean");
    expect(line).toContain("packages/reasoning/src/index.ts");
  });

  it("changed src: dirty flag is loud", () => {
    const p = kernelProvenance(fakeGit(" M packages/reasoning/src/kernel/loop/runner.ts"), "r");
    expect(p.dirty).toBe(true);
    expect(formatKernelProvenance(p)).toContain("DIRTY");
  });

  it("git failure: unknown, never throws", () => {
    const boom: GitRunner = () => {
      throw new Error("no git");
    };
    const p = kernelProvenance(boom, "r");
    expect(p).toEqual({ head: "unknown", srcCommit: "unknown", dirty: "unknown", resolved: "r" });
    expect(formatKernelProvenance(p)).toContain("dirty=unknown");
  });
});
