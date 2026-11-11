/**
 * The chat reads as one column: the transcript, the to-do dock, the error
 * banner, the composer and the loading skeleton all take their width from
 * `--cortex-chat-col` (and their gutter from `--cortex-chat-gutter`), so their
 * edges line up. A fixed pixel width in one of them breaks the alignment.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = join(import.meta.dir, "..");
const read = (p: string) => readFileSync(join(SRC, p), "utf8");

const COLUMN_FILES = [
  "lib/components/chat/ChatThread.svelte",
  "lib/components/chat/ChatComposer.svelte",
  "lib/components/chat/ChatErrorBanner.svelte",
  "lib/components/ChatPanel.svelte",
  "routes/chat/+page.svelte",
];

describe("chat reading column", () => {
  test("the theme defines the column, gutter and prose measure", () => {
    const css = read("app.css");
    expect(css).toMatch(/--cortex-chat-col:\s*\d/);
    expect(css).toMatch(/--cortex-chat-gutter:\s*24px/);
    expect(css).toMatch(/max-width: 900px\)\s*\{\s*:root\s*\{\s*--cortex-chat-gutter:\s*16px/);
    expect(css).toMatch(/--cortex-prose-measure:\s*\d+ch/);
  });

  test("every column part reads the token, none a fixed width", () => {
    for (const f of COLUMN_FILES) {
      const src = read(f);
      expect({ f, uses: src.includes("--cortex-chat-col") }).toEqual({ f, uses: true });
      expect({ f, fixed: /max-w(idth)?[-:[\s]*\[?\s*(808|760)px/.test(src) }).toEqual({ f, fixed: false });
    }
  });

  test("transcript prose caps text lines only, so code blocks and tables use the column", () => {
    const src = read("lib/components/ChatTranscript.svelte");
    expect(src).toContain("max-width: var(--cortex-prose-measure)");
    expect(src).not.toMatch(/\.prose \{[^}]*max-width/);
  });
});
