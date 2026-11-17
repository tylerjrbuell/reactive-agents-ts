import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const DOCS = resolve(import.meta.dir, "..");
const REPO = resolve(DOCS, "../..");
const read = (p: string) => readFileSync(resolve(DOCS, p), "utf8");

/** Phase 1 CTA events (plan 2026-11-17-docs-adoption-readiness). */
const EVENTS = [
  "star_cta_click",
  "quickstart_click",
  "install_copy",
  "subscribe_view",
  "subscribe_submit",
  "subscribe_success",
  "subscribe_error",
  "feedback_open",
  "feedback_submit",
] as const;

describe("conversion surfaces", () => {
  const sources = [
    read("public/umami-deep.js"),
    read("src/components/EmailSubscribe.astro"),
    read("src/components/FeedbackModal.astro"),
  ].join("\n");
  const catalog = readFileSync(resolve(REPO, "wiki/Reference/Umami-Events.md"), "utf8");

  it.each(EVENTS)("event %s is emitted by the docs site and catalogued", (name) => {
    expect(sources).toContain(`"${name}"`);
    expect(catalog).toMatch(new RegExp(`^### .*\`${name}\``, "m"));
  });

  it("never sends the email address to analytics", () => {
    const sub = read("src/components/EmailSubscribe.astro");
    const calls = sub.match(/track\("subscribe_[a-z]+",[^)]*\)/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(4);
    for (const c of calls) expect(c).not.toMatch(/email/i);
  });

  it("every Try-it page id resolves to a content file", () => {
    const m = read("src/components/PageTitle.astro").match(/TRY_IT_PAGES = new Set\(\[([\s\S]*?)\]\)/);
    expect(m).not.toBeNull();
    const ids = [...(m?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((x) => x[1]);
    expect(ids.length).toBeGreaterThanOrEqual(10);
    for (const id of ids) {
      const found = [".md", ".mdx"].some((ext) => existsSync(resolve(DOCS, "src/content/docs", id + ext)));
      expect(found).toBe(true);
    }
  });

  it("the Try-it snippet uses the canonical local-model setup", () => {
    const t = read("src/components/TryIt.astro");
    expect(t).toContain('provider: "ollama"');
    expect(t).toContain("createAgent");
    expect(t).toContain("/guides/quickstart/");
    const i = read("src/components/InstallSnippet.astro");
    expect(i).toContain("bun add reactive-agents");
    expect(i).toContain("npm install reactive-agents");
  });
});

describe("narrow-width header and overflow guards (Starlight 0.43)", () => {
  const header = read("src/components/Header.astro");
  const css = read("src/styles/custom.css");

  it("keeps the Get started and Star CTAs unconditionally visible", () => {
    expect(header).toMatch(/class="ra-header-cta"/);
    expect(header).toMatch(/ra-star-cta ra-header-star/);
    // No rule may hide either CTA at any width.
    expect(header).not.toMatch(/\.ra-header-cta\s*\{[^}]*display:\s*none/);
    expect(header).not.toMatch(/\.ra-header-star\s*\{[^}]*display:\s*none/);
  });

  it("hides the Playground button below 64rem so it never sits under the menu button", () => {
    // The unlayered `display: inline-flex` beats Starlight's layered sl-hidden utility.
    expect(header).toMatch(
      /@media \(max-width: 63\.99rem\)\s*\{\s*\.ra-playground-btn\s*\{\s*display:\s*none;/,
    );
  });

  it("wraps long inline code and clips reveal-transform overhang in page content", () => {
    expect(css).toMatch(/\.sl-markdown-content :not\(pre, th\) > code[^{]*\{\s*overflow-wrap:\s*anywhere;/);
    expect(css).toMatch(/\.sl-markdown-content \{\s*overflow-x:\s*clip;/);
  });
});
