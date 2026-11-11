/**
 * Bench step 8 guard (spec section 9): the old visual layer stays gone. Fails
 * when any source file under `src/` brings back the Material Symbols ligature
 * font or its CDN link, an MD3 colour alias, a retired identity class or a
 * legacy `--cortex-*` alias. Use the kit (`kit/Icon`), the semantic Tailwind
 * colours (`bg-surface-1`, `text-text-2`, `text-accent`, …) and the semantic
 * tokens instead.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const SRC = join(import.meta.dir, "..");
const SELF = relative(SRC, import.meta.path);

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(svelte|ts|css|html)$/.test(name)) out.push(full);
  }
  return out;
}

const MD3 =
  /\b(?:bg|text|border|ring|outline|fill|stroke|from|to|via|divide|placeholder|accent|caret|decoration|shadow)-(?:background|surface(?:-dim|-bright|-container(?:-lowest|-low|-high|-highest)?)?|on-surface(?:-variant)?|outline(?:-variant)?|(?:on-|inverse-)?primary(?:-container|-fixed(?:-dim)?)?|(?:on-)?secondary(?:-container|-fixed(?:-dim)?)?|(?:on-)?tertiary(?:-container|-fixed(?:-dim)?)?|(?:on-)?error(?:-container)?|inverse-surface|inverse-on-surface)(?![\w-])/;

const RULES: readonly { readonly name: string; readonly re: RegExp }[] = [
  { name: "Material Symbols (use kit/Icon)", re: /material-symbols|Material\+Symbols/ },
  { name: "font CDN link (fonts are self-hosted)", re: /fonts\.(googleapis|gstatic)\.com/ },
  { name: "MD3 colour alias (use the semantic colours)", re: MD3 },
  { name: "retired identity class", re: /\b(?:gradient-border|cortex-progress-|hover-lift|sonar-ring|cortex-shell-bg|cortex-kbd|ra-gradient-text)/ },
  { name: "legacy --cortex-* alias", re: /--cortex-(?:bg|surface|surface-low|surface-mid|text-muted|border|nav-bg)\b(?!-)/ },
];

describe("old visual layer is gone (Bench step 8)", () => {
  const files = sourceFiles(SRC).filter((f) => relative(SRC, f) !== SELF);

  test("the scan sees the app", () => {
    expect(files.some((f) => f.endsWith("app.html"))).toBe(true);
    expect(files.some((f) => f.endsWith("app.css"))).toBe(true);
  });

  for (const rule of RULES) {
    test(`no ${rule.name}`, () => {
      const hits: string[] = [];
      for (const file of files) {
        readFileSync(file, "utf8")
          .split("\n")
          .forEach((line, i) => {
            if (rule.re.test(line)) hits.push(`${relative(SRC, file)}:${i + 1}: ${line.trim().slice(0, 120)}`);
          });
      }
      expect(hits).toEqual([]);
    });
  }

  test("the MD3 rule catches an alias and spares the semantic names", () => {
    expect(MD3.test('class="text-on-surface-variant"')).toBe(true);
    expect(MD3.test('class="hover:bg-primary/10"')).toBe(true);
    expect(MD3.test('class="material-symbols-outlined"')).toBe(false);
    expect(MD3.test('class="bg-surface-1 text-text-2 text-accent border-line"')).toBe(false);
  });
});
