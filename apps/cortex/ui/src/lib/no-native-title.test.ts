/**
 * Cortex hover help is its own tooltip (`use:tooltip`, `lib/actions/tooltip.ts`;
 * kit `IconButton` / `Button` / `Chip` apply it), never the browser's native
 * `title` attribute, which ignores the theme and the type scale and never
 * shows on keyboard focus. Component props named `title` (headings on
 * `PageHeader`, `Overlay`, `EmptyState`, …) are fine: only native elements
 * (lowercase tags) are checked.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const SRC = join(import.meta.dir, "..");

function svelteFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...svelteFiles(p));
    else if (name.endsWith(".svelte")) out.push(p);
  }
  return out;
}

/** Native start tags (lowercase name) in markup that carry a `title=` attribute. */
function nativeTitleTags(source: string): string[] {
  const markup = source.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<style[\s\S]*?<\/style>/g, "");
  const hits: string[] = [];
  const open = /<([a-z][a-z0-9-]*)(?=[\s/>])/g;
  let m: RegExpExecArray | null;
  while ((m = open.exec(markup)) !== null) {
    // Read the tag to its closing `>`; `bare` keeps only the attribute names
    // (no `{…}` expressions, no quoted values), so `=>` or a string never counts.
    let i = m.index + m[0].length;
    let depth = 0;
    let quote: string | null = null;
    let bare = "";
    let expr = "";
    let shorthand = false;
    for (; i < markup.length; i++) {
      const c = markup[i];
      if (quote) {
        if (c === quote) quote = null;
      } else if (depth > 0) {
        if (c === "{") depth++;
        else if (c === "}") depth--;
        if (depth === 0) {
          // `{title}` right after whitespace is the attribute shorthand.
          if (/\s$/.test(bare) && expr.trim() === "title") shorthand = true;
          expr = "";
        } else expr += c;
      } else if (c === "{") depth++;
      else if (c === '"' || c === "'") quote = c;
      else if (c === ">") break;
      else bare += c;
    }
    if (shorthand || /\stitle=/.test(bare)) hits.push(markup.slice(m.index, i + 1).replace(/\s+/g, " ").slice(0, 120));
  }
  return hits;
}

describe("no native title tooltips", () => {
  test("the scanner finds a native title and ignores component props", () => {
    expect(nativeTitleTags('<button type="button" title="Delete">x</button>')).toHaveLength(1);
    expect(nativeTitleTags('<span class="a"\n  title={x}>y</span>')).toHaveLength(1);
    expect(nativeTitleTags('<span class="usage" {title} data-x="1">y</span>')).toHaveLength(1);
    expect(nativeTitleTags('<span class="a {title}">y</span>')).toHaveLength(0);
    expect(nativeTitleTags('<PageHeader title="Runs" />')).toHaveLength(0);
    expect(nativeTitleTags('<span use:tooltip={"Delete"}>x</span>')).toHaveLength(0);
    expect(nativeTitleTags('<button onclick={() => (a = b > c)} use:tooltip={t}>x</button>')).toHaveLength(0);
  });

  test("no .svelte file under ui/src puts title= on a native element", () => {
    const offenders: string[] = [];
    for (const file of svelteFiles(SRC)) {
      for (const tag of nativeTitleTags(readFileSync(file, "utf8"))) offenders.push(`${relative(SRC, file)}: ${tag}`);
    }
    expect(offenders).toEqual([]);
  });
});
