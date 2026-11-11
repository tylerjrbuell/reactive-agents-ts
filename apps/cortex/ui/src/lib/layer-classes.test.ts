import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * The z-index layer utilities (`z-sticky` … `z-tooltip`, tailwind.config.ts)
 * must stand alone in a class list. A glued one (`z-modalflex`) is not a class
 * Tailwind knows, so the overlay loses both its layer and its layout: the
 * Terminate confirm rendered under the page and could not be clicked.
 */
const LAYERS = ["sticky", "nav", "drawer", "modal", "toast", "tooltip"];
const GLUED = new RegExp(`\\bz-(?:${LAYERS.join("|")})[a-z]`, "g");

function svelteFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...svelteFiles(p));
    else if (name.endsWith(".svelte")) out.push(p);
  }
  return out;
}

describe("z-index layer classes", () => {
  test("no layer utility is glued to the next class", () => {
    const root = join(import.meta.dir, "..");
    const hits = svelteFiles(root).flatMap((f) => {
      const m = readFileSync(f, "utf8").match(GLUED);
      return m ? m.map((h) => `${f.slice(root.length + 1)}: ${h}`) : [];
    });
    expect(hits).toEqual([]);
  });
});
