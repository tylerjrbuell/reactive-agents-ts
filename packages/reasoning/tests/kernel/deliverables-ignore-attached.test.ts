import { describe, expect, it } from "bun:test";
import { compileRunContract } from "../../src/kernel/contract/run-contract.js";
import { maskAttachedContext } from "../../src/kernel/contract/current-turn.js";
import {
  MAX_DERIVED_DELIVERABLES,
  deriveConditions,
  deriveDeliverablePaths,
} from "../../src/kernel/capabilities/verify/derive-conditions.js";

const agentsMd = [
  "Read before writing. Create wiki/Development/Repo-Navigation.md and save ./wiki/Hot.md.",
  ...Array.from({ length: 60 }, (_, i) => `Write the notes to ./src/mod-${i}/file${i}.ts then create ./docs/page${i}.md`),
].join("\n");

const attached = (body: string): string =>
  `Summarize AGENTS.md\n\n--- Attached file: AGENTS.md ---\n${body}\n--- End attached file ---`;

const artifacts = (task: string): string[] =>
  compileRunContract(task, {}).requirements
    .filter((r) => r.kind === "artifact-produced")
    .map((r) => r.id);

describe("deliverables ignore attached context", () => {
  it("attached AGENTS.md-style block derives no deliverables (contract + stored conditions)", () => {
    const task = attached(agentsMd);
    expect(artifacts(task)).toEqual([]);
    expect(deriveConditions(task, []).some((c) => c._tag === "ArtifactProduced")).toBe(false);
  });

  it("without the envelope the same paths trip the cap: none declared", () => {
    expect(deriveDeliverablePaths(`Summarize AGENTS.md\n${agentsMd}`)).toEqual([]);
  });

  it("a genuine write request still declares exactly one", () => {
    expect(deriveDeliverablePaths("Write the report to ./out/report.md")).toEqual(["./out/report.md"]);
    const task = `Write the report to ./out/report.md\n\n--- Attached file: a.md ---\nCreate ./x/y.md\n--- End attached file ---`;
    expect(artifacts(task)).toEqual(["artifact:./out/report.md"]);
  });

  it("history blocks stay ignored", () => {
    const task = `--- Conversation history ---\nUser: write ./old/one.md\n--- Current message ---\nSummarize it`;
    expect(artifacts(task)).toEqual([]);
  });

  it("cap: at the limit declares all, above it declares none", () => {
    const mk = (n: number): string =>
      `Create these files: ${Array.from({ length: n }, (_, i) => `./o/f${i}.md`).join(", ")}`;
    expect(deriveDeliverablePaths(mk(MAX_DERIVED_DELIVERABLES))).toHaveLength(MAX_DERIVED_DELIVERABLES);
    expect(deriveDeliverablePaths(mk(MAX_DERIVED_DELIVERABLES + 1))).toEqual([]);
  });

  it("read-verb paths are ignored", () => {
    expect(deriveDeliverablePaths("Read ./src/a.ts and explain it")).toEqual([]);
  });

  it("mask keeps offsets; unterminated block masks to end; no block is identity", () => {
    const t = "ask\n--- Attached file: a ---\nxx\n--- End attached file ---\nafter";
    const m = maskAttachedContext(t);
    expect(m.length).toBe(t.length);
    expect(m.endsWith("after")).toBe(true);
    expect(m.includes("xx")).toBe(false);
    expect(maskAttachedContext("ask\n--- Attached file: a ---\nxx").trim()).toBe("ask");
    expect(maskAttachedContext("plain")).toBe("plain");
  });
});
