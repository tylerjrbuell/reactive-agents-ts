/**
 * Seam pin: a flat JSON object preview must not spend its key budget on
 * navigation noise (`*_url`, `url`, `node_id`, `gravatar_id`, `avatar`).
 *
 * Live repro 2026-11-10 (Cortex, ollama 9B): `gh api repos/<owner>/<repo>`
 * returned a 97-key repo object. The preview showed the first keys in order
 * (`id`, `node_id`, `name`, `full_name`, ...); `description` and
 * `stargazers_count` sat behind ~40 `*_url` keys, and the model reported the
 * wrong description.
 */
import { describe, it, expect } from "bun:test";
import { compressToolResult } from "../../src/kernel/capabilities/attend/tool-formatting.js";
import { orderObjectPreviewEntries } from "../../src/kernel/capabilities/attend/object-preview.js";

/** GitHub-repo shape: ids and many `*_url` keys first, the facts later. */
function repoFixture(): Record<string, unknown> {
  const obj: Record<string, unknown> = {
    id: 123456789,
    node_id: "R_kgDOabcdef",
    name: "reactive-agents-ts",
    full_name: "example/reactive-agents-ts",
    private: false,
    owner: { login: "example", id: 1, node_id: "U_x", avatar_url: "https://a" },
    html_url: "https://github.com/example/reactive-agents-ts",
    fork: false,
    url: "https://api.github.com/repos/example/reactive-agents-ts",
  };
  for (let i = 0; i < 40; i++) obj[`thing${i}_url`] = `https://api.github.com/repos/example/x/${i}`;
  obj.created_at = "2025-01-01T00:00:00Z";
  obj.description = "Composable, observable AI agent framework for TypeScript";
  obj.homepage = "https://reactiveagents.dev";
  obj.stargazers_count = 412;
  obj.language = "TypeScript";
  return obj;
}

describe("flat object preview — noise keys dropped, salient first", () => {
  it("repo object: name, description and stargazers_count are visible within the budget", () => {
    const out = compressToolResult(JSON.stringify(repoFixture()), "shell-execute", 600, 3).content;
    expect(out).toContain("Type: Object(54 keys)");
    expect(out).toMatch(/^ {2}name: reactive-agents-ts$/m);
    // Value slices stay budget-scaled (40 chars at this budget).
    expect(out).toMatch(/^ {2}description: Composable, observable AI agent framewor/m);
    expect(out).toMatch(/^ {2}stargazers_count: 412$/m);
    expect(out).not.toMatch(/_url: /);
    expect(out).not.toMatch(/^ {2}node_id: /m);
    expect(out).toContain("(43 url/id fields omitted)");
  });

  it("ordering: SALIENT_FIELDS, then description, then scalars, then nested values", () => {
    const { entries, omitted } = orderObjectPreviewEntries({
      id: 1,
      owner: { login: "o" },
      html_url: "x",
      description: "d",
      topics: ["a"],
      count: 2,
      title: "t",
      name: "n",
    }, 4);
    expect(entries.map(([k]) => k)).toEqual([
      "title",
      "name",
      "description",
      "id",
      "count",
      "owner",
      "topics",
    ]);
    expect(omitted).toBe(1);
  });

  it("object without noise keys renders exactly as before (order kept, no omitted line)", () => {
    // 12 long-valued keys, salient `name` last: over the 600 budget, 9 keys shown.
    const obj: Record<string, unknown> = {};
    for (let i = 0; i < 11; i++) obj[`k${i}`] = `${i}`.repeat(60);
    obj.name = "late-name";
    const out = compressToolResult(JSON.stringify(obj), "http-get", 600, 3).content;
    const key = out.match(/\[STORED: (\S+) /)?.[1];
    expect(out).toBe(
      `[STORED: ${key} | http-get]\n` +
        "Type: Object(12 keys)\n" +
        Array.from({ length: 9 }, (_, i) => `  k${i}: ${`${i}`.repeat(40)}\n`).join("") +
        `  — full object is stored. Use recall("${key}", start: 0, maxChars: 1200), recall("${key}", query: "keyword"), or | transform: for focused extraction.`,
    );
    expect(orderObjectPreviewEntries(obj, 9).omitted).toBe(0);
  });

  it("every key fits in capacity: original order kept, noise keys stay visible", () => {
    const page = { status: "ok", url: "https://example.com/page", name: "n" };
    const { entries, omitted } = orderObjectPreviewEntries(page, 9);
    expect(entries.map(([k]) => k)).toEqual(["status", "url", "name"]);
    expect(omitted).toBe(0);
  });
});
