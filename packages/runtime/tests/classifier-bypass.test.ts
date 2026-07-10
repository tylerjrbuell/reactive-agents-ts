import { describe, it, expect } from "bun:test";
import { literalMentionRequired } from "../src/classifier-bypass.js";

describe("literalMentionRequired", () => {
  const tools = ["web-search", "http-get", "code-execute", "file-write", "spawn-agent"];

  it("picks web-search when task mentions it literally", () => {
    expect(literalMentionRequired("Use web-search to find X", tools)).toEqual(["web-search"]);
  });

  it("picks multiple when multiple mentioned", () => {
    const result = literalMentionRequired("Use web-search then file-write the result", tools);
    expect(result).toContain("web-search");
    expect(result).toContain("file-write");
    expect(result).toHaveLength(2);
  });

  it("picks none when no literal mentions", () => {
    expect(literalMentionRequired("What is the speed of light?", tools)).toEqual([]);
  });

  it("matches hyphenated tool names correctly (not partial words)", () => {
    // "get" shouldn't match "http-get"; "search" shouldn't match "web-search"
    expect(literalMentionRequired("Get me something and search for it", tools)).toEqual([]);
  });

  it("handles case-insensitive matching", () => {
    expect(literalMentionRequired("Use Web-Search to look up prices", tools)).toEqual(["web-search"]);
  });

  it("matches spawn-agent when user says 'spawn a sub-agent'", () => {
    // "spawn-agent" contains a hyphen; user might write "spawn agent" or "spawn-agent"
    expect(literalMentionRequired("Spawn a sub-agent to calculate factorial", tools)).toEqual(["spawn-agent"]);
  });

  it("returns empty for empty inputs", () => {
    expect(literalMentionRequired("", tools)).toEqual([]);
    expect(literalMentionRequired("some task", [])).toEqual([]);
  });

  // ── Inflection tolerance (2026-07-10 regression, trace 01KX6KY8ANMXC1BSQ1SNJN3DAP) ──
  // "several individual web searches" failed the \b adjacency match against
  // "web-search" (plural on the final segment), demoting a classifier-required
  // tool to relevant — which the builtins opt-in filter then stripped entirely.
  it("matches trailing-s plural on the final segment (web searches → web-search)", () => {
    expect(
      literalMentionRequired(
        "Research the show and make several individual web searches, then save to ./show.md",
        ["web-search"],
      ),
    ).toEqual(["web-search"]);
  });

  it("matches trailing-es plural on the final segment", () => {
    expect(
      literalMentionRequired("perform two code-executes in a row", ["code-execute"]),
    ).toEqual(["code-execute"]);
  });

  it("still matches 'search the web' via segment fallback (both segments present)", () => {
    expect(literalMentionRequired("search the web for prices", tools)).toEqual([
      "web-search",
    ]);
  });

  it("does not false-positive on unrelated inflected text", () => {
    // "searchlights"/"webs" must not trip web-search; "researching" has no
    // word-boundary "search"; plural tolerance must not loosen \b anchoring.
    expect(
      literalMentionRequired("the searchlights swept over the webs while researching", tools),
    ).toEqual([]);
  });

  it("does not match gerunds (web searching) — only s/es plurals are tolerated", () => {
    expect(literalMentionRequired("try web searching later", ["web-search"])).toEqual([]);
  });
});
