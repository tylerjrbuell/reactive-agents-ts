/**
 * Seam pin: a JSON object that wraps a list of records (find, web-search,
 * `gh api` search, most HTTP APIs) must preview the records, not `Array(n)`.
 *
 * Live repro 2026-11-10 (Cortex, ollama 9B): `find` returned three matching
 * README chunks inside `{query, results, totalResults, ...}`; the preview read
 * `results: Array(3)` and the model concluded no document was loaded.
 */
import { describe, it, expect } from "bun:test";
import { compressToolResult } from "../../src/kernel/capabilities/attend/tool-formatting.js";
import { renderRecordEnvelopePreview } from "../../src/kernel/capabilities/attend/envelope-preview.js";

const FIND_RESULT = {
  query: "Cortex README",
  results: [
    {
      content: "Cortex is the Reactive Agents desktop studio. It lets you chat with agents, inspect runs and build tools.",
      source: "README.md",
      identifier: "doc:cortex-readme#0",
      score: 0.91,
    },
    {
      content: "Install Cortex with `bun run cortex` from the repo root. The UI starts on port 4321 by default.",
      source: "README.md",
      identifier: "doc:cortex-readme#1",
      score: 0.84,
    },
    {
      content: "Cortex stores chat sessions in a local SQLite database under ~/.reactive-agents/cortex.db.",
      source: "README.md",
      identifier: "doc:cortex-readme#2",
      score: 0.77,
    },
  ],
  totalResults: 4,
  sourcesSearched: ["documents", "memory"],
  storedAs: "_find_1",
};

describe("envelope preview — object wrapping a list of records", () => {
  it("find envelope: every result's content snippet and identifier are visible", () => {
    const out = compressToolResult(JSON.stringify(FIND_RESULT), "find", 600, 3).content;
    // The old preview's whole view of the list was this one line.
    expect(out).not.toMatch(/^ {2}results: Array\(3\)$/m);
    for (const r of FIND_RESULT.results) {
      expect(out).toContain(r.content.slice(0, 40));
      expect(out).toContain(r.identifier);
    }
    // Scalar envelope keys stay visible on one line.
    expect(out).toContain("query=Cortex README");
    expect(out).toContain("totalResults=4");
    expect(out).toContain("[STORED: _tool_result_1 | find]");
  });

  it("gh --json style {total_count, items:[...]} envelope previews the items", () => {
    const items = Array.from({ length: 12 }, (_, i) => ({
      number: 100 + i,
      title: `Fix flaky retry in provider ${i}`,
      state: i % 2 === 0 ? "open" : "closed",
      html_url: `https://github.com/acme/repo/issues/${100 + i}`,
      body: "Long body text ".repeat(20),
    }));
    const payload = { total_count: 12, incomplete_results: false, items };
    const out = compressToolResult(JSON.stringify(payload), "gh-cli", 900, 3).content;
    expect(out).not.toMatch(/^ {2}items: Array\(12\)$/m);
    expect(out).toContain("total_count=12");
    expect(out).toContain("Fix flaky retry in provider 0");
    expect(out).toContain("number=100");
    // Not every item fits: the tail is announced with a recall path that works
    // on an object (recall's arrayStart only slices a top-level array).
    expect(out).toMatch(/\.\.\.\d+ more/);
    expect(out).toContain('recall("_tool_result_1", query:');
    expect(out).not.toContain("arrayStart");
  });

  it("an object without a record array renders exactly as before (regression pin)", () => {
    const plain = {
      status: "ok",
      body: "B".repeat(900),
      url: "https://example.com/page",
      meta: { a: 1, b: 2, c: 3, d: 4 },
      count: 7,
    };
    const out = compressToolResult(JSON.stringify(plain), "http-get", 600, 3).content;
    expect(out).toBe(
      "[STORED: _tool_result_1 | http-get]\nType: Object(5 keys)\n  status: ok\n  body: " +
        "B".repeat(70) +
        "\n  url: https://example.com/page\n  meta: {a, b, c}\n  count: 7\n" +
        '  — full object is stored. Use recall("_tool_result_1", start: 0, maxChars: 1200), recall("_tool_result_1", query: "keyword"), or | transform: for focused extraction.',
    );
    // A scalar-only array is not a record list either: old path, unchanged.
    const tags = { name: "x".repeat(700), tags: ["a", "b", "c"] };
    const tagOut = compressToolResult(JSON.stringify(tags), "t", 600, 3).content;
    expect(tagOut).toContain("tags: Array(3)");
    expect(renderRecordEnvelopePreview(tags, "_k", "t", 600, 3)).toBeUndefined();
  });

  // Live repro 2026-11-10 (Cortex, ollama mimo-v2.6): a name-only `find`
  // returned `outline` and `hint`; the envelope line read
  // `outline={README.md} | hint=Matched document 'README.md' by name. Its outline is listed. Search its content …`
  // so the headings and the guidance never reached the model.
  describe("name-only find: outline and hint reach the model", () => {
    const HEADINGS = [
      "# Cortex",
      "## Prerequisites",
      "## Environment",
      "## Install",
      "## Running the desktop app",
      "## Chat sessions",
      "## Tool workshop",
      "## Run inspector",
      "## Configuration reference",
      "## Troubleshooting",
      "## Contributing",
      "## License",
    ];
    const HINT =
      "Matched document 'README.md' by name. Its outline is listed. Search its content with the words " +
      "of the fact you need, not the document's name, e.g. find('Prerequisites').";
    const NAME_ONLY_FIND = {
      ...FIND_RESULT,
      query: "README.md",
      documents: ["README.md"],
      outline: { "README.md": HEADINGS },
      hint: HINT,
    };

    it("wide budget: every heading and the full hint are visible", () => {
      // A 4000-char result passes through raw; render the preview directly.
      const out = renderRecordEnvelopePreview(NAME_ONLY_FIND, "_k", "find", 4000, 3) ?? "";
      expect(out).not.toContain("outline={README.md}");
      for (const h of HEADINGS) expect(out).toContain(h);
      expect(out).toContain("README.md: # Cortex · ## Prerequisites · ## Environment");
      expect(out).toContain(HINT);
    });

    it("local budget: the full hint survives and headings show up to budget with …+N", () => {
      const out = compressToolResult(JSON.stringify(NAME_ONLY_FIND), "find", 600, 3).content;
      expect(out).toContain(HINT);
      expect(out).toContain("## Environment");
      expect(out).toMatch(/…\+\d+/);
      // Records still render: the envelope line does not starve them.
      for (const r of FIND_RESULT.results) expect(out).toContain(r.identifier);
    });

    it("a tiny budget clips the hint to what fits but keeps it first", () => {
      const out = renderRecordEnvelopePreview(NAME_ONLY_FIND, "_k", "find", 250, 3) ?? "";
      const line = out.split("\n")[2] ?? "";
      expect(line.startsWith("  hint=Matched document")).toBe(true);
    });

    it("zero-hit find (no record list, generic object path) keeps its full hint", () => {
      const noHit = {
        query: "cortex port",
        results: [],
        totalResults: 0,
        sourcesSearched: ["documents"],
        documents: ["README.md", "CHANGELOG.md", "docs/architecture-overview.md", "docs/setup-guide.md"],
        hint:
          "No passage matched 'cortex port'. Loaded documents: README.md, CHANGELOG.md, " +
          "docs/architecture-overview.md, docs/setup-guide.md. Try a content keyword from the question.",
        padding: "p".repeat(700),
      };
      const out = compressToolResult(JSON.stringify(noHit), "find", 600, 3).content;
      expect(out).toContain(`hint: ${noHit.hint}`);
    });

    it("a large nested object keeps the {keys} form", () => {
      const big = { ...FIND_RESULT, meta: { a: { x: 1 }, b: 2, c: 3, d: 4 } };
      const out = renderRecordEnvelopePreview(big, "_k", "find", 4000, 3) ?? "";
      expect(out).toContain("meta={a, b, c}");
    });
  });

  it("budget scaling still moves the envelope output", () => {
    const longResults = {
      ...FIND_RESULT,
      results: FIND_RESULT.results.map((r) => ({ ...r, content: r.content + " " + "detail ".repeat(200) })),
    };
    const raw = JSON.stringify(longResults);
    expect(raw.length).toBeGreaterThan(4000); // both tiers compress
    const small = compressToolResult(raw, "find", 600, 3).content;
    const large = compressToolResult(raw, "find", 4000, 3).content;
    expect(large).not.toBe(small);
    expect(large.length).toBeGreaterThan(small.length);
    // The wider tier shows more of each record's content, not just more keys.
    const detailRuns = (s: string): number => (s.match(/detail/g) ?? []).length;
    expect(detailRuns(large)).toBeGreaterThan(detailRuns(small));
    for (const r of FIND_RESULT.results) {
      expect(small).toContain(r.identifier);
      expect(large).toContain(r.identifier);
    }
    // The small tier stays near its budget (header overhead included).
    expect(small.length).toBeLessThanOrEqual(600 + 400);
  });
});
