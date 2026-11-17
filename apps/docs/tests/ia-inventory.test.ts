import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildInventory,
  DOCS_ROOT,
  extractRawLinks,
  extractSidebarText,
  h2Set,
  isTopicExempt,
  pagesMissingTopic,
  loadPages,
  parseFrontmatter,
  parseSidebar,
  REPO_ROOT,
  renderReport,
  resolveLink,
  shingles,
  slugOf,
  splitFrontmatter,
  type PageSource,
} from "../scripts/ia-inventory";

const page = (slug: string, body: string, fm = ""): PageSource => ({
  slug,
  file: `apps/docs/src/content/docs/${slug || "index"}.md`,
  frontmatter: parseFrontmatter(`title: ${slug || "Home"}\n${fm}`),
  body,
});

const CONFIG = `
export default {
  integrations: [{
    sidebar: [
      { label: 'Start', items: [
        { label: 'A', link: 'guides/a/' },
        { label: 'Deep', collapsed: true, items: [{ label: 'B', link: 'guides/b/' }] },
      ] },
      { label: 'Cook', collapsed: true, autogenerate: { directory: 'cookbook' } },
      { label: "Quote ] in 'string'", items: [{ label: 'D', link: 'guides/d/' }] },
    ],
  }],
}`;

describe("ia-inventory: frontmatter and slugs", () => {
  it("parses title, folded description, sidebar order and future schema keys", () => {
    const fm = parseFrontmatter("title: T\ndescription: >-\n  a\n  b\nsidebar:\n  order: 4\ntopic: tools\nrelated: [x, y]");
    expect(fm.title).toBe("T");
    expect(fm.description).toBe("a b");
    expect(fm.order).toBe(4);
    expect(fm.topic).toBe("tools");
    expect(fm.related).toEqual(["x", "y"]);
  });

  it("splits frontmatter from body", () => {
    const { fm, body } = splitFrontmatter("---\ntitle: X\n---\nhello");
    expect(fm).toBe("title: X");
    expect(body).toBe("hello");
  });

  it("maps files to slugs, including index files", () => {
    expect(slugOf("/r/index.mdx", "/r")).toBe("");
    expect(slugOf("/r/guides/a.md", "/r")).toBe("guides/a");
    expect(slugOf("/r/features/cortex/index.mdx", "/r")).toBe("features/cortex");
  });
});

describe("ia-inventory: sidebar parsing", () => {
  it("is bracket- and string-aware", () => {
    const text = extractSidebarText(CONFIG);
    expect(text.startsWith("[")).toBe(true);
    expect(text.endsWith("]")).toBe(true);
    expect(text).toContain("guides/d/");
  });

  it("flattens links, nested collapsed groups and autogenerate groups", () => {
    const pages = [page("guides/a", ""), page("guides/b", ""), page("guides/d", ""), page("cookbook/x", "", "sidebar:\n  order: 2"), page("cookbook/y", "", "sidebar:\n  order: 1")];
    const entries = parseSidebar(CONFIG, pages);
    const get = (slug: string) => entries.filter((e) => e.slug === slug);
    expect(get("guides/a")[0]).toMatchObject({ group: "Start", position: 1, collapsedAncestors: 0 });
    expect(get("guides/b")[0]).toMatchObject({ group: "Start > Deep", position: 1, collapsedAncestors: 1 });
    expect(get("cookbook/y")[0]).toMatchObject({ group: "Cook", position: 1, collapsedAncestors: 1, via: "autogenerate" });
    expect(get("cookbook/x")[0]?.position).toBe(2);
    expect(get("guides/d")[0]?.group).toContain("Quote");
  });
});

describe("ia-inventory: links", () => {
  const known = new Set(["", "guides/a", "guides/b", "reference/cli"]);

  it("extracts markdown, href and frontmatter links, ignoring code and images", () => {
    const body = "see [a](/guides/a/) and ![img](/x.png)\n```\n[no](/guides/b/)\n```\n`[no](/guides/b/)`\n<LinkCard href=\"../b/\" />";
    expect(extractRawLinks(body, "actions:\n  - text: Go\n    link: guides/a/")).toEqual(["/guides/a/", "../b/", "guides/a/"]);
  });

  it("resolves absolute, relative and flags redirects and broken links", () => {
    expect(resolveLink("/guides/a/", "guides/b", known)).toMatchObject({ target: "guides/a", kind: "ok" });
    expect(resolveLink("../a/#x", "guides/b", known)).toMatchObject({ target: "guides/a", kind: "ok" });
    expect(resolveLink("/guides/a", "guides/b", known)).toMatchObject({ target: "guides/a", kind: "redirected" });
    expect(resolveLink("/reference/CLI/", "guides/b", known)).toMatchObject({ kind: "broken" });
    expect(resolveLink("/nope/", "guides/b", known)).toMatchObject({ kind: "broken", target: null });
    expect(resolveLink("/playground/", "guides/b", known)).toMatchObject({ kind: "non-content" });
    expect(resolveLink("https://x.dev", "guides/b", known)).toBeNull();
    expect(resolveLink("#frag", "guides/b", known)).toBeNull();
    expect(resolveLink("guides/a/", "", known)).toMatchObject({ target: "guides/a", kind: "ok" });
  });
});

describe("ia-inventory: orphan, depth, duplicate logic", () => {
  const pages = [
    page("", "[go](/guides/a/)"),
    page("guides/a", "[b](../b/)"),
    page("guides/b", "end"),
    page("guides/d", "[a](../a/)"),
    page("guides/orphan", "nothing links here"),
    page("cookbook/x", "x"),
  ];
  const inv = buildInventory(pages, CONFIG);
  const rec = (slug: string) => inv.pages.find((p) => p.slug === slug)!;

  it("lists every page once", () => {
    expect(inv.pages.length).toBe(pages.length);
    expect(inv.summary.pageCount).toBe(pages.length);
  });

  it("flags orphans only when there is no sidebar entry and no inbound link", () => {
    expect(rec("guides/orphan").orphan).toBe(true);
    expect(rec("guides/d").orphan).toBe(false);
    expect(rec("guides/d").noSidebar).toBe(false);
    expect(rec("guides/b").orphan).toBe(false);
  });

  it("computes click depth from home with the sidebar and link-only variants", () => {
    expect(rec("guides/a").depth).toBe(1);
    expect(rec("guides/b").depth).toBe(2);
    expect(rec("guides/b").linkDepth).toBe(2);
    expect(rec("guides/d").depth).toBe(2);
    expect(rec("guides/d").linkDepth).toBeNull();
    expect(rec("cookbook/x").depth).toBe(3);
    expect(rec("guides/orphan").depth).toBeNull();
  });

  it("flags duplicate titles and shared H2 structure", () => {
    const dup = buildInventory(
      [
        { ...page("guides/a", ""), frontmatter: parseFrontmatter("title: Same Title") },
        { ...page("guides/b", ""), frontmatter: parseFrontmatter("title: same  title") },
      ],
      CONFIG,
    );
    expect(dup.titleGroups).toEqual([{ title: "Same Title", slugs: ["guides/a", "guides/b"] }]);
    expect(h2Set("## One\ntext\n### Sub\n```\n## code\n```\n## Two")).toEqual(new Set(["one", "two"]));
  });

  it("flags near-duplicate text and reports over-length pages", () => {
    const words = Array.from({ length: 200 }, (_, i) => `word${i}`).join(" ");
    const twin = buildInventory([page("guides/a", words), page("guides/b", `${words} extra`)], CONFIG);
    expect(twin.nearDuplicatePairs.length).toBe(1);
    const long = buildInventory([page("guides/a", "word ".repeat(3600))], CONFIG);
    expect(long.pages[0]!.overLength).toBe(true);
    expect(shingles(["a", "b", "c"], 2)).toEqual(new Set(["a b", "b c"]));
  });

  it("renders deterministically", () => {
    expect(renderReport(buildInventory(pages, CONFIG))).toBe(renderReport(buildInventory(pages, CONFIG)));
  });
});

describe("ia-inventory: real docs", () => {
  it("inventories every content file exactly once", () => {
    const pages = loadPages(DOCS_ROOT);
    const inv = buildInventory(pages, readFileSync(join(REPO_ROOT, "apps/docs/astro.config.mjs"), "utf8"));
    expect(inv.pages.length).toBe(pages.length);
    expect(new Set(inv.pages.map((p) => p.slug)).size).toBe(pages.length);
  });

  it("topic gate fails on a page without topic, exempting features/cortex and the 404 page", () => {
    const pages = [
      { slug: "guides/a", hasTopic: true },
      { slug: "guides/b", hasTopic: false },
      { slug: "features/cortex", hasTopic: false },
      { slug: "features/cortex/tour", hasTopic: false },
      { slug: "features/cortexy", hasTopic: false },
      { slug: "404", hasTopic: false },
    ];
    expect(pagesMissingTopic(pages)).toEqual(["guides/b", "features/cortexy"]);
    expect(isTopicExempt("features/cortex/voice")).toBe(true);
    expect(isTopicExempt("features/cortexy")).toBe(false);
  });

  it("every non-exempt content page carries a topic", () => {
    const pages = loadPages(DOCS_ROOT).map((p) => ({ slug: p.slug, hasTopic: p.frontmatter.topic !== null }));
    expect(pagesMissingTopic(pages)).toEqual([]);
  });

  it("proposal disposition table covers every page exactly once", () => {
    const proposalPath = join(REPO_ROOT, "wiki/Reference/Docs-IA-Proposal.md");
    if (!existsSync(proposalPath)) return;
    const text = readFileSync(proposalPath, "utf8");
    const section = text.split("<!-- disposition:start -->")[1]?.split("<!-- disposition:end -->")[0] ?? "";
    const listed = [...section.matchAll(/^\|\s*`(\/[^`]*)`\s*\|/gm)].map((m) => m[1]!);
    const slugs = loadPages(DOCS_ROOT).map((p) => (p.slug === "" ? "/" : `/${p.slug}/`)).sort();
    expect(listed.sort()).toEqual(slugs);
  });
});
