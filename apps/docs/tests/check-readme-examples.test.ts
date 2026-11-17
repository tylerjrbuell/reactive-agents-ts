import { describe, expect, it } from "bun:test";
import { checkBlocks, extractBlocks, hasPlaceholder, ownerOf, renderTable } from "../scripts/check-readme-examples";

const FENCE = "```";

describe("extractBlocks", () => {
  it("extracts ts and tsx blocks, ignores other fences", () => {
    const md = ["# t", `${FENCE}bash`, "echo hi", FENCE, `${FENCE}ts`, "const a = 1;", FENCE, `${FENCE}tsx`, "const b = <div />;", FENCE].join("\n");
    const blocks = extractBlocks(md, "README.md");
    expect(blocks.map((b) => b.lang)).toEqual(["ts", "tsx"]);
    expect(blocks[0]!.startLine).toBe(5);
  });

  it("marks blocks after a skip-typecheck comment", () => {
    const md = ["<!-- skip-typecheck -->", `${FENCE}ts`, "oops(", FENCE].join("\n");
    expect(extractBlocks(md, "README.md")[0]!.skipReason).toBe("marker");
  });

  it("marks standalone ... placeholders but not spread", () => {
    expect(hasPlaceholder("foo(...)")).toBe(true);
    expect(hasPlaceholder("const o = { ... }")).toBe(true);
    expect(hasPlaceholder("const o = { ...rest }")).toBe(false);
    expect(hasPlaceholder("f(...args)")).toBe(false);
  });
});

describe("ownerOf", () => {
  const entries = [{ glob: "packages/runtime/**", owner: "runtime-warden" }];
  it("maps the root README to docs-warden and packages via ownership", () => {
    expect(ownerOf("README.md", entries)).toBe("docs-warden");
    expect(ownerOf("packages/runtime/README.md", entries)).toBe("runtime-warden");
    expect(ownerOf("packages/zzz/README.md", entries)).toBe("unowned");
  });
});

describe("checkBlocks", () => {
  it("passes a valid block, fails an invalid one, skips pseudo", () => {
    const md = [
      `${FENCE}ts`, "const n: number = 1;", FENCE,
      `${FENCE}ts`, "const s: string = 1;", FENCE,
      `${FENCE}ts`, "foo(...)", FENCE,
    ].join("\n");
    const results = checkBlocks(extractBlocks(md, "README.md"));
    expect(results.map((r) => r.status)).toEqual(["PASS", "FAIL", "SKIP"]);
    expect(renderTable(results, [])).toContain("| README.md | 4 | FAIL |");
  });
});
