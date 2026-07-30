// Run: bun test packages/tools/src/skills/render-result.test.ts
//
// 2026-07-30: root cause of a live run losing most of 25 requested gh-cli
// commits across TWO independent layers (compressToolResult in the
// reasoning package, fixed separately; and this shared renderer, used by
// both `write-result-to-file` and the assembly-layer `ResultStore`). Both
// layers stored the raw NDJSON stdout as an opaque STRING because
// `JSON.parse` fails on multi-line NDJSON — `asArray` then returned
// undefined, so `renderValue`/`describeShape` treated the whole blob as an
// unstructured string, and any downstream bounded-preview fell back to a
// blind character-slice with no per-commit boundary awareness.
import { describe, expect, it } from "bun:test";
import { asArray, renderValue, describeShape } from "./render-result.js";

const ndjson = [
  { sha: "1111111", message: "fix: repair guard", author: "alice" },
  { sha: "2222222", message: "feat: add thing", author: "bob" },
  { sha: "3333333", message: "docs: update readme", author: "carol" },
]
  .map((c) => JSON.stringify(c))
  .join("\n");

describe("asArray — NDJSON recognition", () => {
  it("parses one-JSON-object-per-line text as an array", () => {
    const arr = asArray(ndjson);
    expect(arr).toBeDefined();
    expect(arr).toHaveLength(3);
    expect((arr?.[0] as { sha: string }).sha).toBe("1111111");
  });

  it("does not misfire on a single-line JSON string", () => {
    expect(asArray('{"a":1}')).toBeUndefined();
  });

  it("does not misfire on ordinary multi-line non-JSON text", () => {
    expect(asArray("Usage: rax [options]\n  --help   Show help\n  agent    Manage agents")).toBeUndefined();
  });
});

describe("renderValue — NDJSON string input", () => {
  it("renders ALL items from an NDJSON string, not a truncated opaque blob", () => {
    const rendered = renderValue(ndjson, "bullets");
    expect(rendered).toContain("fix: repair guard");
    expect(rendered).toContain("feat: add thing");
    expect(rendered).toContain("docs: update readme");
  });
});

describe("describeShape — NDJSON string input", () => {
  it("reports the real array shape instead of a generic string/object", () => {
    expect(describeShape(ndjson)).toContain("Array(3)");
  });
});

// General failure mode (not gh-cli-specific): "bullets" used to pick ONE
// guessed-salient field per record and silently drop every other scalar
// field. Any task asking for multiple fields per item (sha + author +
// message, id + price + name, whatever) saw only the salient text — the
// model then fabricated plausible-looking values for the fields it never
// saw. This must hold for ANY multi-field record shape, not just commits.
describe("renderValue — bullets never drops a scalar field", () => {
  it("keeps every field for flat records (order id + amount + status)", () => {
    const orders = [
      { id: "ord-1", amount: 42.5, status: "shipped", note: "leave at door" },
      { id: "ord-2", amount: 10, status: "pending", note: "call first" },
    ];
    const rendered = renderValue(orders, "bullets");
    expect(rendered).toContain("id=ord-1");
    expect(rendered).toContain("amount=42.5");
    expect(rendered).toContain("status=shipped");
    expect(rendered).toContain("id=ord-2");
    expect(rendered).toContain("amount=10");
    expect(rendered).toContain("status=pending");
  });

  it("keeps every field for the raw gh-api commit shape (sha + nested commit.author.date)", () => {
    const commits = [
      {
        sha: "abc1234",
        commit: { message: "fix: repair guard", author: { name: "Tyler", date: "2026-04-10T12:00:00Z" } },
      },
    ];
    const rendered = renderValue(commits, "bullets");
    expect(rendered).toContain("fix: repair guard");
    expect(rendered).toContain("sha=abc1234");
    expect(rendered).toContain("commit.author.name=Tyler");
    expect(rendered).toContain("commit.author.date=2026-04-10T12:00:00Z");
  });

  it("still surfaces the salient field first when only one is present (no regression on plain records)", () => {
    const searchResults = [{ title: "Result One" }, { title: "Result Two" }];
    const rendered = renderValue(searchResults, "bullets");
    expect(rendered).toContain("- Result One");
    expect(rendered).toContain("- Result Two");
  });
});
