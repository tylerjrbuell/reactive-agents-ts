// Run: bun run repo test apps/docs/src/content/indicators.test.ts
import { describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CURRENT_RELEASE,
  CURRENT_VERSION,
  formatMinor,
  indicatorsFor,
  isInWindow,
  markerLabel,
  pagePathFromDocId,
  parseMinor,
  readCurrentRelease,
  redundantStabilityLabel,
  changedLead,
  deriveCurrentVersion,
  extractHeadings,
  extractSectionMarkers,
  releaseStructureTags,
  tocMarks,
  type TocNode,
  inWindow,
  joinNames,
  latestReleaseTag,
  listReachableTags,
  pageMarkFor,
  resolveVersion,
  rollupFor,
  sidebarAttrs,
  upcomingRelease,
  validateVersions,
} from "./indicators.js";
import { parseLastCommits } from "./last-commit.js";

const at = (v: string) => parseMinor(v)!;

describe("release window", () => {
  it("parses minors and rejects junk", () => {
    expect(parseMinor("0.18")).toEqual({ major: 0, minor: 18 });
    expect(parseMinor("v0.18.3")).toEqual({ major: 0, minor: 18 });
    expect(parseMinor("latest")).toBeNull();
  });

  it("covers the current and previous minor plus the upcoming one", () => {
    const cur = at("0.18.0");
    expect(isInWindow("0.19", cur)).toBe(true);
    expect(isInWindow("0.18", cur)).toBe(true);
    expect(isInWindow("0.17", cur)).toBe(true);
    expect(isInWindow("0.16", cur)).toBe(false);
    expect(isInWindow("0.20", cur)).toBe(false);
  });

  it("markers expire when the current release moves on", () => {
    const page = { since: "0.18" };
    expect(indicatorsFor(page, at("0.18.0")).marker).toEqual({ kind: "new", version: "0.18" });
    expect(indicatorsFor(page, at("0.19.0")).marker).toEqual({ kind: "new", version: "0.18" });
    expect(indicatorsFor(page, at("0.20.0")).marker).toBeUndefined();
  });

  it("New outranks Updated; Updated shows when the page is old", () => {
    const cur = at("0.19.0");
    expect(indicatorsFor({ since: "0.19", updated: "0.19" }, cur).marker?.kind).toBe("new");
    expect(indicatorsFor({ since: "0.10", updated: "0.19" }, cur).marker).toEqual({ kind: "updated", version: "0.19" });
    expect(indicatorsFor({ since: "0.10", updated: "0.12" }, cur).marker).toBeUndefined();
  });

  it("stability never expires and is independent of the marker", () => {
    const ind = indicatorsFor({ since: "0.01", stability: "experimental" }, at("0.30.0"));
    expect(ind).toEqual({ stability: "experimental" });
  });

  it("labels the marker", () => {
    expect(markerLabel({ kind: "updated", version: "0.19" })).toBe("Updated in 0.19");
  });
});

describe("sidebar indicators", () => {
  it("stability is a compact attribute for non-stable tiers only, never a text badge", () => {
    const a = sidebarAttrs({ stability: "unstable", marker: { kind: "new", version: "0.19" } })!;
    expect(a["data-ra-stability"]).toBe("unstable");
    expect(a["data-ra-stability-label"]).toBe("Unstable");
    expect(a.title).toBe("New in 0.19 · Unstable");
    expect(sidebarAttrs({ stability: "stable" })).toBeUndefined();
    expect(sidebarAttrs({ stability: "deprecated" })?.["data-ra-stability"]).toBe("deprecated");
    expect(sidebarAttrs({})).toBeUndefined();
  });

  it("markers are icon attributes with a tooltip, no text badge", () => {
    expect(sidebarAttrs({ marker: { kind: "updated", version: "0.19" } })).toEqual({
      "data-ra-new-content": "updated",
      "data-ra-marker-label": "Updated in 0.19",
      title: "Updated in 0.19",
    });
    expect(sidebarAttrs({ stability: "experimental" })?.["data-ra-new-content"]).toBeUndefined();
  });

  it("the sidebar never renders a text pill: route-middleware sets no stability badge", () => {
    const src = readFileSync(join(import.meta.dir, "../route-middleware.ts"), "utf8");
    expect(src).not.toMatch(/STABILITY_BADGE|sidebarBadgeFor/);
    // The only badges are the version chip and the roll-up dot.
    expect(src.match(/entry\.badge\s*=/g)?.length).toBe(2);
  });

  it("CSS keeps the label column unsqueezed: indicators fixed, label shrinks and wraps", () => {
    const css = readFileSync(join(import.meta.dir, "../styles/custom.css"), "utf8");
    const row = css.match(/\.sidebar-pane a \{[^}]*\}/)?.[0] ?? "";
    expect(row).toContain("display: flex");
    expect(row).toContain("align-items: flex-start");
    const label = css.match(/\.sidebar-pane a > span:first-child \{[^}]*\}/)?.[0] ?? "";
    expect(label).toContain("min-width: 0");
    expect(label).not.toMatch(/word-break:\s*(break-all|break-word)/);
    const glyph = css.match(/\.sidebar a\[data-ra-stability\]::after \{[^}]*\}/)?.[0] ?? "";
    expect(glyph).toContain("flex: none");
    // Nothing may force the last child (the label) to stop shrinking.
    expect(css).not.toMatch(/\.sidebar-pane a > :last-child/);
    // No literal colours in the indicator block.
    const block = css.slice(css.indexOf("/* New/Updated icons."), css.indexOf("/* ── Email subscription form"));
    expect(block).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});

describe("section markers and roll-ups", () => {
  const cur = at("0.19.0");
  const src = [
    "## Plain",
    "## Ollama Cloud <Since version=\"0.19\" />",
    "### `withX()` rewrite <Since version=\"0.19\" type=\"updated\" />",
    "## Old <Since version=\"0.12\" />",
    "## Gone <Since version=\"0.19\" type=\"deprecated\" />",
    "```md",
    "## Fenced <Since version=\"0.19\" />",
    "```",
  ].join("\n");

  it("extracts tagged headings, skipping fences and deprecated", () => {
    const s = extractSectionMarkers(src);
    expect(s.map((x) => x.text)).toEqual(["Ollama Cloud", "withX() rewrite", "Old"]);
    expect(inWindow(s, cur).map((x) => x.text)).toEqual(["Ollama Cloud", "withX() rewrite"]);
  });

  it("page mark carries section names in its label; section-only pages are marked", () => {
    const m = pageMarkFor({ updated: "0.19" }, extractSectionMarkers(src), cur)!;
    expect(m.kind).toBe("updated");
    expect(m.label).toBe("Updated in 0.19: Ollama Cloud, withX() rewrite");
    const only = pageMarkFor({}, extractSectionMarkers("## A <Since version=\"0.19\" />"), cur)!;
    expect(only).toMatchObject({ kind: "new", label: "New in 0.19: A" });
    expect(pageMarkFor({}, extractSectionMarkers("## Old <Since version=\"0.12\" />"), cur)).toBeUndefined();
  });

  it("roll-up is new when any descendant is new, undefined when none is marked", () => {
    const mk = (kind: "new" | "updated") => ({ kind, version: "0.19", label: "x", sections: [] });
    expect(rollupFor([])).toBeUndefined();
    expect(rollupFor([{ label: "A", mark: mk("updated") }, { label: "B", mark: mk("new") }])?.kind).toBe("new");
    expect(rollupFor([{ label: "A", mark: mk("updated") }])).toEqual({ kind: "updated", text: "1 new or updated in 0.19: A" });
    expect(joinNames(["a", "b", "c", "d", "e", "f"], 4)).toBe("a, b, c, d and 2 more");
  });
});

describe("nav redundancy guard", () => {
  it("flags a label that repeats the tier its badge shows", () => {
    expect(redundantStabilityLabel("x", "Plan Review (experimental)", "experimental")).toContain("repeats");
    expect(redundantStabilityLabel("x", "Plan Review", "experimental")).toBeNull();
    expect(redundantStabilityLabel("x", "Experimental thing", "stable")).toBeNull();
    expect(redundantStabilityLabel("x", "Experimental thing", undefined)).toBeNull();
  });

  it("no sidebar label in astro.config repeats a stability word next to a badge", () => {
    const cfg = readFileSync(join(import.meta.dir, "../../astro.config.mjs"), "utf8");
    const labels = [...cfg.matchAll(/label:\s*['"]([^'"]+)['"]/g)].map((m) => m[1]!);
    expect(labels.filter((l) => /\((experimental|unstable|beta|alpha|deprecated)\)/i.test(l))).toEqual([]);
  });
});

describe("single release constant", () => {
  it("matches the top released heading of the whats-new page", () => {
    const page = readFileSync(join(import.meta.dir, "docs/guides/whats-new.mdx"), "utf8");
    const top = page.match(/^## v(\d+\.\d+\.\d+)\b/m)?.[1];
    expect(top).toBeDefined();
    expect(formatMinor(parseMinor(top!)!)).toBe(formatMinor(CURRENT_RELEASE));
  });

  it("is derived (env > tag > VERSION), never a package manifest", () => {
    const repoRoot = join(import.meta.dir, "../../../..");
    expect(CURRENT_VERSION).toBe(deriveCurrentVersion(repoRoot).version);
    expect(CURRENT_VERSION).toBe(
      resolveVersion({
        env: process.env.RA_DOCS_VERSION,
        tags: listReachableTags(repoRoot),
        file: readFileSync(join(repoRoot, "VERSION"), "utf8"),
      }).version,
    );
  });

  it("resolution order: env beats tag beats VERSION file", () => {
    const both = { tags: ["v0.18.0", "v0.19.0"], file: "0.18.0" };
    expect(resolveVersion({ ...both, env: "v0.21.2" })).toEqual({ version: "0.21.2", source: "env" });
    expect(resolveVersion(both)).toEqual({ version: "0.19.0", source: "git-tag" });
    expect(resolveVersion({ tags: [], file: "0.18.0\n" })).toEqual({ version: "0.18.0", source: "version-file" });
    expect(() => resolveVersion({ tags: [], file: "oops" })).toThrow("no docs version");
    expect(() => resolveVersion({ env: "oops" })).toThrow("RA_DOCS_VERSION");
  });

  it("latest tag is by semver, not lexical order; pre-releases and junk are ignored", () => {
    expect(latestReleaseTag(["v0.9.0", "v0.18.0", "v0.10.2", "v0.18.1", "v0.19.0-rc.1", "foo", "v1"])).toBe("0.18.1");
    expect(latestReleaseTag([])).toBeNull();
  });

  it("a new tag moves chip, badge, window and expiry with no file edit", () => {
    const repo = mkdtempSync(join(tmpdir(), "ra-tag-"));
    const git = (...a: string[]) => execFileSync("git", ["-C", repo, ...a], { stdio: "ignore" });
    git("init", "-q");
    git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "--allow-empty", "-q", "-m", "a");
    git("tag", "v0.18.0");
    writeFileSync(join(repo, "VERSION"), "0.18.0\n");
    const page = { since: "0.18", updated: "0.20" };
    const state = () => {
      const d = deriveCurrentVersion(repo, {});
      const cur = parseMinor(d.version)!;
      return {
        chip: `v${d.version}`,
        badge: `v${formatMinor(cur)}`,
        marker: indicatorsFor(page, cur).marker,
        upcoming: formatMinor(upcomingRelease(cur)),
        beyond: validateVersions("p", { since: "0.20" }, cur).length,
        source: d.source,
      };
    };
    const before = state();
    expect(before).toEqual({ chip: "v0.18.0", badge: "v0.18", marker: { kind: "new", version: "0.18" }, upcoming: "0.19", beyond: 1, source: "git-tag" });
    // Tag a release. VERSION is NOT touched.
    git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "--allow-empty", "-q", "-m", "b");
    git("tag", "v0.19.0");
    expect(readFileSync(join(repo, "VERSION"), "utf8").trim()).toBe("0.18.0");
    expect(state()).toEqual({ chip: "v0.19.0", badge: "v0.19", marker: { kind: "new", version: "0.18" }, upcoming: "0.20", beyond: 0, source: "git-tag" });
    git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "--allow-empty", "-q", "-m", "c");
    git("tag", "v0.20.0");
    // 0.18 left the window (0.19 .. 0.21), so New expires and Updated 0.20 takes over.
    expect(state().marker).toEqual({ kind: "updated", version: "0.20" });
  });

  it("astro.config carries no hand-typed version badge", () => {
    const cfg = readFileSync(join(import.meta.dir, "../../astro.config.mjs"), "utf8");
    expect(cfg).not.toMatch(/badge:\s*\{\s*text:\s*['"](v?\d|New)/);
  });
});

describe("validation", () => {
  const cur = at("0.18.0");
  it("accepts current and upcoming, rejects beyond, malformed and inverted", () => {
    expect(validateVersions("a", { since: "0.19" }, cur)).toEqual([]);
    expect(validateVersions("a", { since: "0.20" }, cur)[0]).toContain("beyond the upcoming release 0.19");
    expect(validateVersions("a", { updated: "soon" }, cur)[0]).toContain("not a version");
    expect(validateVersions("a", { since: "0.19", updated: "0.18" }, cur)[0]).toContain("older than since");
  });
});

describe("readCurrentRelease", () => {
  it("reads the VERSION file", () => {
    const dir = mkdtempSync(join(tmpdir(), "ra-release-"));
    writeFileSync(join(dir, "VERSION"), "0.21.4\n");
    expect(readCurrentRelease(dir)).toEqual({ major: 0, minor: 21 });
  });
  it("reads the real repo VERSION", () => {
    expect(readCurrentRelease().major).toBe(0);
  });
});

describe("path + git helpers", () => {
  it("maps doc ids to routes", () => {
    expect(pagePathFromDocId("index")).toBe("/");
    expect(pagePathFromDocId("guides/tools/index")).toBe("/guides/tools/");
    expect(pagePathFromDocId("guides/quickstart")).toBe("/guides/quickstart/");
  });

  it("keeps the newest commit per file from one git log pass", () => {
    const log = "\u0001aaa1111|2026-11-10\na/x.md\na/y.md\n\n\u0001bbb2222|2026-11-01\na/x.md\na/z.md\n";
    const m = parseLastCommits(log);
    expect(m.get("a/x.md")).toEqual({ hash: "aaa1111", date: "2026-11-10" });
    expect(m.get("a/z.md")).toEqual({ hash: "bbb2222", date: "2026-11-01" });
    expect(m.size).toBe(3);
  });
});

describe("TOC markers", () => {
  const cur = at("0.18.0");
  const node = (slug: string, text: string, depth: number, children: TocNode[] = []): TocNode => ({ slug, text, depth, children });

  const whatsNew = [
    "## Unreleased (next minor)",
    "### Framework",
    "### Security hardening",
    "## v0.18.0 - Workspaces, skills, and a single run scope (November 2026)",
    "### Highlights",
    "## v0.17.0 - Older",
    "### Old highlights",
    "## Older releases",
  ].join("\n");
  const whatsNewToc = [
    node("_top", "Overview", 2),
    node("unreleased-next-minor", "Unreleased (next minor)", 2, [node("framework", "Framework", 3), node("security-hardening", "Security hardening", 3)]),
    node("v0180", "v0.18.0 - Workspaces, skills, and a single run scope (November 2026)", 2, [node("highlights", "Highlights", 3)]),
    node("v0170", "v0.17.0 - Older", 2, [node("old-highlights", "Old highlights", 3)]),
    node("older-releases", "Older releases", 2),
  ];

  it("What's New: Unreleased and the current release are new, derived from structure alone", () => {
    const tags = releaseStructureTags(extractHeadings(whatsNew), cur);
    expect(tags.map((t) => t && `${t.kind}:${t.version}`)).toEqual([
      "new:0.19", "new:0.19", "new:0.19", "new:0.18", "new:0.18", undefined, undefined, undefined,
    ]);
    const { marks, sections } = tocMarks(whatsNewToc, extractHeadings(whatsNew), cur, "guides/whats-new");
    expect(Object.keys(marks).sort()).toEqual(["framework", "highlights", "security-hardening", "unreleased-next-minor", "v0180"]);
    expect(marks["framework"]).toEqual({ kind: "new", label: "New in 0.19", rolledUp: false });
    expect(marks["v0180"]!.label).toBe("New in 0.18");
    expect(sections.map((s) => s.slug)).toEqual(["unreleased-next-minor", "v0180"]);
  });

  it("tagging a release moves the derived markers with no content edit", () => {
    // Same headings, but the current release is now 0.19: "Unreleased" becomes 0.20, v0.18.0 loses its marker.
    const { marks } = tocMarks(whatsNewToc, extractHeadings(whatsNew), at("0.19.0"), "guides/whats-new");
    expect(marks["unreleased-next-minor"]!.label).toBe("New in 0.20");
    expect(marks["v0180"]).toBeUndefined();
    expect(marks["highlights"]).toBeUndefined();
  });

  it("archive pages and other pages get nothing from structure", () => {
    expect(tocMarks(whatsNewToc, extractHeadings(whatsNew), cur, "guides/whats-new/v0-17").marks).toEqual({});
    expect(tocMarks(whatsNewToc, extractHeadings(whatsNew), cur, "guides/memory").marks).toEqual({});
  });

  it("a parent rolls up marked children without hiding them; names kept", () => {
    const body = ["## Overview", "### Ollama Cloud <Since version=\"0.19\" />", "### Streaming <Since version=\"0.19\" type=\"updated\" />", "### Plain", "## Other"].join("\n");
    const toc = [
      node("_top", "Overview", 2),
      node("overview", "Overview", 2, [node("ollama-cloud", "Ollama Cloud", 3), node("streaming", "Streaming", 3), node("plain", "Plain", 3)]),
      node("other", "Other", 2),
    ];
    const { marks, sections } = tocMarks(toc, extractHeadings(body), cur, "guides/x");
    expect(marks["ollama-cloud"]).toEqual({ kind: "new", label: "New in 0.19", rolledUp: false });
    expect(marks["streaming"]).toEqual({ kind: "updated", label: "Updated in 0.19", rolledUp: false });
    expect(marks["overview"]).toEqual({ kind: "new", label: "New in 0.19: Ollama Cloud, Streaming", rolledUp: true });
    expect(marks["plain"]).toBeUndefined();
    expect(marks["other"]).toBeUndefined();
    expect(sections.map((s) => s.slug)).toEqual(["ollama-cloud", "streaming"]);
  });

  it("Since tags outside the window are ignored; entries match by text even with punctuation", () => {
    const body = "## Old <Since version=\"0.12\" />\n## `withX()` rewrite, 2 <Since version=\"0.19\" />";
    const toc = [node("old", "Old", 2), node("withx-rewrite-2", "withX() rewrite, 2", 2)];
    expect(Object.keys(tocMarks(toc, extractHeadings(body), cur, "guides/x").marks)).toEqual(["withx-rewrite-2"]);
  });

  it("What changed lead: single kind, mixed kinds, none", () => {
    const s = (kind: "new" | "updated", version = "0.19") => ({ slug: "a", text: "A", kind, version });
    expect(changedLead([s("new"), s("new")])).toEqual({ kind: "new", text: "New in 0.19" });
    expect(changedLead([s("updated")])).toEqual({ kind: "updated", text: "Updated in 0.19" });
    expect(changedLead([s("new"), s("updated", "0.18")])?.text).toBe("New or updated in 0.19");
    expect(changedLead([])).toBeUndefined();
  });
});
