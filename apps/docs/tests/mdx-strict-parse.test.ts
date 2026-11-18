/**
 * Strict MDX parse pin for every docs page.
 *
 * Why: the Astro 7 MDX pipeline does not fail the build on a JSX end-tag
 * mismatch. On 2026-11-18 the homepage "What's different" panel closed its
 * inner wrapper with an indented `  </div>` right after a bullet list. Markdown
 * read the indent as a continuation of the last list item, the build recovered
 * silently and emitted `<divclassra-panel-innerWhat’s class="ra-panel-inner">`:
 * an unknown inline element, so the panel lost its dark fill and padding and
 * painted dark line-box fragments at its left corners.
 *
 * Plain `@mdx-js/mdx` rejects the same source (`end-tag-mismatch`), so a strict
 * compile of every page catches the class before it ships. Fix pattern: put the
 * closing tag of a wrapper that contains markdown at column 0.
 */
import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { compile } from "@mdx-js/mdx";

const DOCS_ROOT = resolve(import.meta.dir, "../src/content/docs");

const listMdx = (dir: string): readonly string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return listMdx(path);
    return entry.name.endsWith(".mdx") ? [path] : [];
  });

const stripFrontmatter = (source: string): string =>
  source.replace(/^---\n[\s\S]*?\n---\n/, "");

describe("docs MDX parses strictly", () => {
  const files = listMdx(DOCS_ROOT);

  it("finds the docs pages", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it("every .mdx page compiles with plain @mdx-js/mdx (no JSX end-tag mismatch)", async () => {
    const failures: string[] = [];
    for (const file of files) {
      const source = stripFrontmatter(readFileSync(file, "utf8"));
      try {
        await compile(source, { jsx: true });
      } catch (error) {
        const reason =
          error instanceof Error ? error.message : String(error);
        failures.push(`${relative(DOCS_ROOT, file)}: ${reason}`);
      }
    }
    expect(failures).toEqual([]);
  });
});
