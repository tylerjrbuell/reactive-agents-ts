/**
 * Cortex has one pick list: the kit `Select` (`components/kit/Select.svelte`,
 * rules in `lib/select.ts`). A native select ignores the theme, cannot search
 * and renders differently per browser, so none may be added to a component or
 * route markup. Script, style and comments are not checked (prose may mention
 * the element).
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

/** Markup with script, style and comments removed. */
function markupOf(source: string): string {
  return source
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/<style[\s\S]*?<\/style>/g, "")
    .replace(/<!--[\s\S]*?-->/g, "");
}

describe("no native select", () => {
  test("the detector sees a select element and ignores comments and prose", () => {
    expect(/<select[\s>]/.test(markupOf('<div><select id="a"></select></div>'))).toBe(true);
    expect(/<select[\s>]/.test(markupOf("<!-- a <select> here --><p>pick</p>"))).toBe(false);
  });

  test("no .svelte file renders a native <select>", () => {
    const offenders = svelteFiles(SRC)
      .filter((f) => /<select[\s>]/.test(markupOf(readFileSync(f, "utf8"))))
      .map((f) => relative(SRC, f));
    expect(offenders).toEqual([]);
  });

  test("the kit Select is in place for the guard to protect", () => {
    expect(statSync(join(SRC, "lib/components/kit/Select.svelte")).isFile()).toBe(true);
  });
});
