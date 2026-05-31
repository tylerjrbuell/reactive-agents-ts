import { describe, it, expect } from "bun:test";
import { ResultStore } from "../../src/overhaul/result-store.js";
import { renderValue } from "@reactive-agents/tools";

// A realistic list_commits shape (nested commit.message, like GitHub MCP).
const commits = Array.from({ length: 20 }, (_, i) => ({
  sha: `sha${i}`,
  commit: { message: `feat: change number ${i}\n\nbody paragraph that should NOT appear in a one-line bullet` },
  author: { name: "Tyler" },
}));

describe("overhaul/result-store — system store + deterministic materializer", () => {
  it("materializes ALL N items as bullets, regardless of size (fixes overflow)", () => {
    const store = new ResultStore();
    const ref = store.put("github/list_commits", commits);
    const out = store.materialize(ref, "bullets");
    const lines = out.split("\n");
    expect(lines.length).toBe(20); // ALL 20, not a preview of 8
    expect(lines[0]).toBe("- feat: change number 0"); // salient nested field, first line only
    expect(out).not.toContain("body paragraph"); // multi-line body stripped
  });

  it("summary is a clean system summary — NO bulk, NO [STORED:] marker, NO recall hint", () => {
    const store = new ResultStore();
    const ref = store.put("github/list_commits", commits);
    const summary = store.summarize(ref);
    expect(summary).toContain(`result_ref="${ref}"`);
    expect(summary).toContain("Array(20)");
    expect(summary).not.toContain("[STORED:");
    expect(summary).not.toContain("recall(");
    expect(summary).not.toContain("body paragraph"); // no bulk data leaks into the summary
  });

  it("ref is stable, legible, tool-derived", () => {
    const store = new ResultStore();
    expect(store.put("github/list_commits", [])).toBe("list_commits_1");
    expect(store.put("github/list_commits", [])).toBe("list_commits_2");
  });

  it("unknown ref does not throw — returns explicit marker", () => {
    const store = new ResultStore();
    expect(store.materialize("nope_1")).toContain('unknown result_ref="nope_1"');
  });

  it("json + table formats", () => {
    expect(renderValue([{ a: 1 }], "json")).toContain('"a": 1');
    const table = renderValue([{ a: 1, b: 2 }], "table");
    expect(table).toContain("| a | b |");
    expect(table).toContain("| 1 | 2 |");
  });

  it("array wrappers ({items|data|commits|...}) are unwrapped", () => {
    const store = new ResultStore();
    const ref = store.put("x/y", { items: [{ name: "one" }, { name: "two" }] });
    expect(store.materialize(ref, "lines").split("\n")).toEqual(["one", "two"]);
  });
});
