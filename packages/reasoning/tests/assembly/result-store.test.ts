import { describe, it, expect } from "bun:test";
import { ResultStore } from "../../src/assembly/result-store.js";

const commits = Array.from({ length: 20 }, (_, i) => ({ sha: `s${i}`, commit: { message: `m${i}` } }));

describe("ResultStore — content-addressed, system-owned", () => {
  it("put returns a stable ref; same content → same ref (CAS)", () => {
    const s = new ResultStore();
    const r1 = s.put("github/list_commits", commits);
    const r2 = s.put("github/list_commits", commits);
    expect(r1).toBe(r2); // content-addressed
    expect(s.get(r1)?.value).toEqual(commits);
  });

  it("summarize gives shape + ref, no bulk, no marker, no recall", () => {
    const s = new ResultStore();
    const ref = s.put("github/list_commits", commits);
    const sum = s.summarize(ref);
    expect(sum).toContain("Array(20)");
    expect(sum).toContain(ref);
    expect(sum).not.toContain("[STORED:");
    expect(sum).not.toContain("recall(");
    expect(sum).not.toContain("m0");
  });

  it("materialize renders ALL items deterministically", () => {
    const s = new ResultStore();
    const ref = s.put("github/list_commits", commits);
    expect(s.materialize(ref, "bullets").split("\n").length).toBe(20);
  });

  it("unknown ref does not throw", () => {
    expect(new ResultStore().materialize("nope")).toContain("nope");
  });
});
